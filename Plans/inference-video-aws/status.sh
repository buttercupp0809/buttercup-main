#!/usr/bin/env bash
# Show the Wan box state, IP, and whether ComfyUI is answering.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh
IID="$(grep -E '^INSTANCE_ID=' "$VSTATE" | cut -d= -f2)"
[ -z "${IID:-}" ] && { echo "no INSTANCE_ID in $VSTATE"; exit 1; }

read -r STATE IP < <(aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress]' --output text)
echo "instance: $IID"
echo "state:    $STATE"
echo "ip:       ${IP:-<none>}"
if [ "$STATE" = "running" ] && [ -n "${IP:-}" ] && [ "$IP" != "None" ]; then
  code="$(curl -m 5 -s -o /dev/null -w '%{http_code}' "http://$IP:8188/system_stats" 2>/dev/null || echo 000)"
  echo "comfyui:  http=$code  ($([ "$code" = 200 ] && echo up || echo 'not answering'))"
  echo "billing:  ~\$1.86/hr (running)"
else
  echo "billing:  compute halted (EBS ~\$18/mo only)"
fi
