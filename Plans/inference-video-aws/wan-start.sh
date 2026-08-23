#!/usr/bin/env bash
# Start ONLY the Wan 2.2 video box, refresh the firewall to your current IP,
# wait for ComfyUI, and print the endpoint. Completely separate from the
# Stheno/Juggernaut box (Plans/inference-aws/20-start.sh); running this never
# touches Stheno or Juggernaut. The public IP CHANGES on each start (no EIP), so
# this prints the POPPY_WAN_URL to set. Models persist on EBS (no re-download);
# ComfyUI is up ~1-2 min after "running".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh
IID="$(grep -E '^INSTANCE_ID=' "$VSTATE" | cut -d= -f2)"
[ -z "${IID:-}" ] && { echo "no INSTANCE_ID in $VSTATE"; exit 1; }

st="$(aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text)"
if [ "$st" = "running" ]; then echo "already running"; else
  echo "Starting Wan video box $IID ..."
  aws --region "$AWS_REGION" ec2 start-instances --instance-ids "$IID" >/dev/null
  aws --region "$AWS_REGION" ec2 wait instance-running --instance-ids "$IID"
fi

# Refresh SG to current public IP (home IP may have changed).
MYIP="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
for p in 22 8188; do
  aws --region "$AWS_REGION" ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=poppy-video-owner}]" 2>/dev/null || true
done

IP="$(aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
grep -v '^PUBLIC_IP=' "$VSTATE" > "$VSTATE.tmp" 2>/dev/null || true
{ cat "$VSTATE.tmp" 2>/dev/null; echo "PUBLIC_IP=$IP"; } > "$VSTATE"; rm -f "$VSTATE.tmp"

echo "running. IP=$IP"
echo "Waiting for ComfyUI on :8188 ..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "http://$IP:8188/system_stats" >/dev/null 2>&1; then echo "ComfyUI up"; break; fi
  sleep 10; [ "$i" -eq 30 ] && echo "not up yet - check: ssh ubuntu@$IP 'journalctl -u poppy-wan'"
done
echo
echo "Set this in the backend to route video to the box:"
echo "  POPPY_WAN_URL=http://$IP:8188"
