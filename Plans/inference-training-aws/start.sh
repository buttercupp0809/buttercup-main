#!/usr/bin/env bash
# Start a stopped training box, refresh the SG to your current IP,
# and wait for the training API to answer.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

aws_() { aws --region "$AWS_REGION" "$@"; }

[[ -f "$VSTATE" ]] || { echo "No .state file. Run ./deploy.sh first."; exit 1; }
source "$VSTATE"

STATE=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].State.Name" --output text)
echo "current state: $STATE"

if [[ "$STATE" != "running" ]]; then
  echo "starting $INSTANCE_ID ..."
  aws_ ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
  aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  echo "running"
fi

IP=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)

# Update .state with the new IP (changes on every start when no EIP).
sed -i.bak "s/^PUBLIC_IP=.*/PUBLIC_IP=$IP/" "$VSTATE" && rm -f "${VSTATE}.bak"
echo "ip=$IP"

# Refresh SG rule to current owner IP for SSH and training-API ports.
MYIP="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
for PORT in 22 8188 8282 8184 8185; do
  # Remove stale rules with old IPs (best-effort).
  STALE=$(aws_ ec2 describe-security-groups --group-ids "$SG_ID" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`$PORT\`].IpRanges[?contains(Description,'poppy-lora')].CidrIp" \
    --output text 2>/dev/null || true)
  for stale_ip in $STALE; do
    [[ "$stale_ip" == "$MYIP" ]] && continue
    aws_ ec2 revoke-security-group-ingress --group-id "$SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,IpRanges=[{CidrIp=$stale_ip}]" \
      2>/dev/null && echo "  revoked :$PORT $stale_ip" || true
  done
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,IpRanges=[{CidrIp=$MYIP,Description=poppy-lora-training-owner}]" \
    2>/dev/null && echo "  opened :$PORT" || echo "  :$PORT rule current"
done

echo ""
echo "Waiting for training API at http://${IP}:8282/health ..."
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "http://${IP}:8282/health" >/dev/null 2>&1; then
    echo "training-api up"
    break
  fi
  echo "  attempt $i/60 ..."
  sleep 10
done
echo ""
echo "Box ready: ip=$IP"
echo "  POPPY_TRAINING_URL=http://${IP}:8282"
echo "  POPPY_ARCFACE_URL=http://${IP}:8184"
echo "  POPPY_CAPTION_URL=http://${IP}:8185"
