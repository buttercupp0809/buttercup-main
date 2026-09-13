#!/usr/bin/env bash
# Stop the training box (halts compute billing; models on EBS survive).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

aws_() { aws --region "$AWS_REGION" "$@"; }

[[ -f "$VSTATE" ]] || { echo "No .state file. Nothing to stop."; exit 0; }
source "$VSTATE"

STATE=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].State.Name" --output text 2>/dev/null || echo "unknown")
echo "current state: $STATE"

if [[ "$STATE" == "stopped" || "$STATE" == "stopping" ]]; then
  echo "already stopped."
  exit 0
fi

echo "stopping $INSTANCE_ID ..."
aws_ ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
aws_ ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
echo "stopped. EBS models preserved."
