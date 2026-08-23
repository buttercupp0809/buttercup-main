#!/usr/bin/env bash
# Stop ONLY the Wan 2.2 video box -> halts its ~$1.86/hr compute billing.
# Completely separate from the Stheno/Juggernaut box (Plans/inference-aws/30-stop.sh);
# running this never touches Stheno or Juggernaut. Instance is STOPPED (not
# terminated), so models on EBS survive; ~$18/mo gp3 storage still applies.
# Bring it back with ./wan-start.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh
IID="$(grep -E '^INSTANCE_ID=' "$VSTATE" | cut -d= -f2)"
[ -z "${IID:-}" ] && { echo "no INSTANCE_ID in $VSTATE"; exit 1; }

echo "Stopping Wan video box $IID ..."
aws --region "$AWS_REGION" ec2 stop-instances --instance-ids "$IID" >/dev/null
aws --region "$AWS_REGION" ec2 wait instance-stopped --instance-ids "$IID"
echo "STOPPED. Wan compute billing halted (EBS ~\$18/mo still applies). Restart: ./wan-start.sh"
