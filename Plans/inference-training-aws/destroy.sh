#!/usr/bin/env bash
# Remove ALL resources created by deploy.sh:
#   - EC2 instance (terminates it; EBS deleted on termination)
#   - IAM instance profile + role + inline policy
#   - SG rules added for training-API ports
#
# Does NOT delete the VPC, subnet, or SG (shared with inference-aws).
#
# Type DESTROY at the prompt to confirm. This is irreversible.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

aws_() { aws --region "$AWS_REGION" "$@"; }

echo "=== poppy-lora-training destroy ==="
echo "This will TERMINATE the EC2 instance and delete the IAM role."
read -rp "Type DESTROY to confirm: " CONFIRM
[[ "$CONFIRM" == "DESTROY" ]] || { echo "aborted."; exit 1; }

if [[ -f "$VSTATE" ]]; then
  source "$VSTATE"

  echo "Terminating $INSTANCE_ID ..."
  aws_ ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null
  aws_ ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
  echo "  terminated."
else
  echo "No .state file; skipping instance termination."
fi

echo "Removing IAM instance profile $IAM_PROFILE_NAME ..."
aws iam remove-role-from-instance-profile \
  --instance-profile-name "$IAM_PROFILE_NAME" \
  --role-name "$IAM_ROLE_NAME" 2>/dev/null && echo "  removed role from profile" || true
aws iam delete-instance-profile \
  --instance-profile-name "$IAM_PROFILE_NAME" 2>/dev/null && echo "  deleted profile" || true

echo "Removing IAM role $IAM_ROLE_NAME ..."
aws iam delete-role-policy \
  --role-name "$IAM_ROLE_NAME" \
  --policy-name "poppy-lora-s3" 2>/dev/null && echo "  deleted inline policy" || true
aws iam delete-role \
  --role-name "$IAM_ROLE_NAME" 2>/dev/null && echo "  deleted role" || true

echo "Removing SG training-API rules ..."
for PORT in 8282 8184 8185; do
  RULES=$(aws_ ec2 describe-security-groups --group-ids "$SG_ID" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`$PORT\`].IpRanges[?contains(Description,'poppy-lora')].CidrIp" \
    --output text 2>/dev/null || true)
  for cidr in $RULES; do
    aws_ ec2 revoke-security-group-ingress --group-id "$SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,IpRanges=[{CidrIp=$cidr}]" \
      2>/dev/null && echo "  revoked :$PORT $cidr" || true
  done
done

rm -f "$VSTATE"
echo ""
echo "destroy complete. All poppy-lora-training resources removed."
