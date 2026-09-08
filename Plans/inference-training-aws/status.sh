#!/usr/bin/env bash
# Read-only: show instance state, IP, and month-to-date cost estimate.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

aws_() { aws --region "$AWS_REGION" "$@"; }

if [[ ! -f "$VSTATE" ]]; then
  echo "No .state file found. Box not yet deployed."
  exit 0
fi
source "$VSTATE"

INFO=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].{State:State.Name,IP:PublicIpAddress,Type:InstanceType,AZ:Placement.AvailabilityZone,Launch:LaunchTime}" \
  --output json 2>/dev/null || echo "{}")

STATE=$(echo "$INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('State','unknown'))" 2>/dev/null || echo "unknown")
IP=$(echo "$INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('IP') or '(none)')" 2>/dev/null || echo "(none)")
TYPE=$(echo "$INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('Type','?'))" 2>/dev/null || echo "?")
AZ=$(echo "$INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('AZ','?'))" 2>/dev/null || echo "?")

echo "=== poppy-lora-training box ==="
echo "  instance  : $INSTANCE_ID ($TYPE, $AZ)"
echo "  state     : $STATE"
echo "  ip        : $IP"
echo ""

if [[ "$STATE" == "running" ]]; then
  echo "  Services (requires box to be ready after user-data):"
  for PORT_NAME in "8282:training-api" "8184:arcface-api" "8185:caption-api" "8188:comfyui"; do
    PORT="${PORT_NAME%%:*}"; NAME="${PORT_NAME##*:}"
    if curl -fsS --max-time 3 "http://${IP}:${PORT}/health" >/dev/null 2>&1; then
      echo "    :$PORT $NAME UP"
    else
      echo "    :$PORT $NAME DOWN/not ready"
    fi
  done
  echo ""
fi

# Month-to-date cost estimate (Cost Explorer; requires ce:GetCostAndUsage permission).
START="$(date -u +%Y-%m-01)"
END="$(date -u +%Y-%m-%d)"
MTD=$(aws ce get-cost-and-usage \
  --time-period "Start=${START},End=${END}" \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --filter "{\"Tags\":{\"Key\":\"Project\",\"Values\":[\"$PROJECT\"]}}" \
  --query "ResultsByTime[0].Total.UnblendedCost.Amount" \
  --output text 2>/dev/null || echo "n/a (ce:GetCostAndUsage permission required)")
echo "  MTD cost  : \$$MTD"
