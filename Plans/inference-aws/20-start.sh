#!/usr/bin/env bash
# ============================================================
# 20-start - start the instance, refresh firewall to your IP,
# wait for the two APIs, print endpoints. Simple command.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
require_state
IID="$(state_get INSTANCE_ID)"; SG_ID="$(state_get SG_ID)"
[[ -z "$IID" ]] && die "no INSTANCE_ID in state"

st="$(instance_state)"
if [[ "$st" == "running" ]]; then ok "already running"; else
  log "Starting $IID"; aws_ ec2 start-instances --instance-ids "$IID" >/dev/null
  aws_ ec2 wait instance-running --instance-ids "$IID"; ok "running"
fi

# refresh SG to current public IP (home IP may have changed)
MYIP="$(my_ip)/32"
log "Ensuring firewall allows $MYIP"
for p in "${OPEN_PORTS[@]}"; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=owner}]" 2>/dev/null || true
done

IP="$(instance_ip)"; state_set LAST_IP "$IP"
echo -e "\n${BOLD}Instance IP:${NC} $IP"
echo    "SSH:   ssh -i keys/$(state_get KEY_NAME).pem ubuntu@$IP"

log "Waiting for services (first boot can take several min while models download)"
for svc in "Stheno:8001/v1/models" "Juggernaut:8188/"; do
  name="${svc%%:*}"; path="${svc#*:}"
  for i in $(seq 1 60); do
    if curl -fsS --max-time 5 "http://$IP:${path}" >/dev/null 2>&1; then ok "$name up"; break; fi
    sleep 10; [[ $i -eq 60 ]] && warn "$name not responding yet - check: ssh in, 'journalctl -u poppy-${name,,}'"
  done
done

echo -e "\n${GREEN}Ready.${NC}"
echo    "  Stheno (OpenAI API):  http://$IP:8001/v1"
echo    "  Juggernaut   (ComfyUI):     http://$IP:8188"
echo    "  Stop when done:       ./30-stop.sh   (auto-stops after ${IDLE_MINUTES}m idle anyway)"
