#!/usr/bin/env bash
# Video-box doctor: make the Wan 2.2 box HEALTHY and reachable, auto-fixing the
# known failure modes this project keeps hitting, then patch POPPY_WAN_URL so a
# freshly started worker talks to the right place. Idempotent and safe to run
# before every worker start (that is exactly what scripts/dev-video.sh does).
#
# It heals, in order:
#   1. Firewall drift  -> re-authorize the current owner IP on 22 + 8188.
#   2. Box stopped     -> start it (new IP on start; we re-read + patch it).
#   3. Box hung (swap  -> reboot it (keeps IP). A single heavy render can OOM the
#      death-spiral)      g6e.xlarge; ports stay open but SSH/HTTP wedge.
#   4. ComfyUI reverted-> the on-box poppy-wan-upgrade.service re-pins v0.3.77;
#      / not on 8188      we just wait for it, and bounce Caddy if 8188 is dark.
#
# Exit 0 = box healthy (ComfyUI answering on :8188 with the Wan nodes). Non-zero
# = could not heal (message says what is wrong and the one manual step to take).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

BACKEND_ENV="$(cd ../../backend && pwd)/.env"
IID="$(grep -E '^INSTANCE_ID=' "$VSTATE" | cut -d= -f2)"
[ -z "${IID:-}" ] && { echo "DOCTOR: no INSTANCE_ID in $VSTATE"; exit 1; }
PEM_ABS="$(cd ../.. && pwd)/$KEY_PEM"
SSH="ssh -i $PEM_ABS -o StrictHostKeyChecking=no -o ConnectTimeout=12"

log() { echo "DOCTOR: $*"; }

http_ok()  { curl -fsS --max-time 8 "http://$1:8188/system_stats" >/dev/null 2>&1; }
wan_nodes_ok() {
  curl -fsS --max-time 20 "http://$1:8188/object_info" 2>/dev/null \
    | grep -q '"WanImageToVideo"'
}
tcp_open() { nc -z -w 5 "$1" 22 >/dev/null 2>&1; }
ssh_ok()   { $SSH ubuntu@"$1" "echo ok" >/dev/null 2>&1; }

instance_state() {
  aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null
}
instance_ip() {
  aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text 2>/dev/null
}

refresh_firewall() {
  local myip; myip="$(curl -s --max-time 8 https://checkip.amazonaws.com | tr -d '[:space:]')/32"
  for p in 22 8188; do
    aws --region "$AWS_REGION" ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$myip,Description=poppy-video-owner}]" \
      >/dev/null 2>&1 || true
  done
  log "firewall refreshed for $myip"
}

patch_wan_url() {
  local ip="$1"
  if [ -f "$BACKEND_ENV" ] && grep -q '^POPPY_WAN_URL=' "$BACKEND_ENV"; then
    sed -i.bak -E "s#^POPPY_WAN_URL=.*#POPPY_WAN_URL=http://$ip:8188#" "$BACKEND_ENV" && rm -f "$BACKEND_ENV.bak"
    log "patched POPPY_WAN_URL -> http://$ip:8188"
  fi
}

wait_for_http() { # ip, tries
  local ip="$1" tries="${2:-30}"
  for _ in $(seq 1 "$tries"); do http_ok "$ip" && return 0; sleep 10; done
  return 1
}

# --- Heal ------------------------------------------------------------------
refresh_firewall

STATE="$(instance_state)"
log "instance state = ${STATE:-unknown}"
if [ "$STATE" != "running" ]; then
  log "starting box ..."
  aws --region "$AWS_REGION" ec2 start-instances --instance-ids "$IID" >/dev/null 2>&1 || true
  aws --region "$AWS_REGION" ec2 wait instance-running --instance-ids "$IID" 2>/dev/null || true
  sleep 15
fi

IP="$(instance_ip)"
[ -z "${IP:-}" ] || [ "$IP" = "None" ] && { log "no public IP yet; aborting"; exit 1; }
log "box IP = $IP"
patch_wan_url "$IP"

# Already healthy? Fast path.
if http_ok "$IP" && wan_nodes_ok "$IP"; then
  log "HEALTHY (ComfyUI + Wan nodes on :8188)"; exit 0
fi

# Distinguish a genuinely HUNG box (OOM/swap death-spiral) from one that is
# merely BUSY booting or running the pin service (git + pip + model reload pin
# the CPU and look identical to a hang from outside). Only a SUSTAINED wedge --
# ports open but SSH refusing across a multi-minute window -- counts as hung.
# This prevents a reboot loop where the doctor keeps rebooting a box that just
# needs a few more minutes to finish coming up.
if tcp_open "$IP" && ! ssh_ok "$IP"; then
  log "SSH not answering; watching for up to 4 min (could be booting/pinning, not hung) ..."
  wedged=1
  for _ in $(seq 1 12); do
    if ssh_ok "$IP" || http_ok "$IP"; then wedged=0; break; fi
    sleep 20
  done
  if [ "$wedged" = "1" ]; then
    log "SSH + HTTP wedged for 4 min with ports open -> genuinely hung. Rebooting (keeps IP) ..."
    aws --region "$AWS_REGION" ec2 reboot-instances --instance-ids "$IID" >/dev/null 2>&1 || true
    sleep 60
    for _ in $(seq 1 30); do ssh_ok "$IP" || http_ok "$IP" && break; sleep 10; done
  else
    log "box came back on its own (was just busy)"
  fi
fi

# Wait for the on-boot pin service to finish, then ensure Caddy exposes 8188.
if ssh_ok "$IP"; then
  log "waiting for on-box ComfyUI pin service ..."
  $SSH ubuntu@"$IP" "for i in \$(seq 1 30); do systemctl is-active poppy-wan-upgrade.service | grep -q active && break; sleep 5; done" >/dev/null 2>&1 || true
  log "bouncing Caddy (8188 proxy) in case it lost the ComfyUI race ..."
  $SSH ubuntu@"$IP" "docker exec poppy-wan supervisorctl restart caddy" >/dev/null 2>&1 || true
fi

log "waiting for :8188 to answer ..."
if ! wait_for_http "$IP" 30; then
  log "FAILED: :8188 not answering. Manual: ssh ubuntu@$IP 'docker exec poppy-wan supervisorctl status'"
  exit 1
fi
if ! wan_nodes_ok "$IP"; then
  log "8188 up but Wan nodes missing -> re-running pin service ..."
  $SSH ubuntu@"$IP" "sudo systemctl restart poppy-wan-upgrade.service" >/dev/null 2>&1 || true
  wait_for_http "$IP" 30 || true
fi

if http_ok "$IP" && wan_nodes_ok "$IP"; then
  log "HEALTHY (recovered)"; exit 0
fi
log "FAILED: box not healthy after auto-heal. Manual check: ssh ubuntu@$IP"
exit 1
