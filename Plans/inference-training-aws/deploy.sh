#!/usr/bin/env bash
# ONE-TIME provisioning for the poppy-lora-training box.
#
# What this does:
#   1. Creates IAM role + instance profile for S3 access (idempotent).
#   2. Adds SG rules for training API ports (8282, 8184, 8185) to your IP.
#   3. Resolves the latest DLAMI AMI from SSM.
#   4. Renders user-data.sh by prepending config variables.
#   5. Launches the g5.xlarge instance with the rendered user-data.
#   6. Attaches the IAM instance profile.
#   7. Records the instance ID and IP to .state.
#
# Idempotent for IAM (creates only if absent). NOT idempotent for the
# instance launch (re-running after a partial failure may launch a second
# instance; check .state first and ./destroy.sh if needed).
#
# APPROVAL REQUIRED per repo guardrails (CLAUDE.md / CLAUDE.md project).
# Do not run without explicit human approval.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

aws_() { aws --region "$AWS_REGION" "$@"; }

echo "== [1/7] IAM role + instance profile =="

# Trust policy: allow EC2 to assume this role.
TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

# S3 policy: checkpoint upload (lora/*) + image/model reads (everything else).
S3_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject","s3:PutObjectAcl"],
      "Resource": "arn:aws:s3:::${S3_BUCKET}/lora/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::${S3_BUCKET}/*"
    }
  ]
}
EOF
)

# Create role (idempotent: skip if exists).
if ! aws iam get-role --role-name "$IAM_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$IAM_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  echo "  created role $IAM_ROLE_NAME"
else
  echo "  role $IAM_ROLE_NAME already exists"
fi

# Put (upsert) the inline S3 policy.
aws iam put-role-policy --role-name "$IAM_ROLE_NAME" \
  --policy-name "poppy-lora-s3" \
  --policy-document "$S3_POLICY"
echo "  upserted s3 inline policy"

# Create instance profile (idempotent).
if ! aws iam get-instance-profile --instance-profile-name "$IAM_PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$IAM_PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$IAM_PROFILE_NAME" \
    --role-name "$IAM_ROLE_NAME"
  echo "  created instance profile $IAM_PROFILE_NAME"
else
  echo "  instance profile $IAM_PROFILE_NAME already exists"
fi

echo "== [2/7] Add SG rules for training APIs =="
MYIP="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
for PORT in 8282 8184 8185; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,IpRanges=[{CidrIp=$MYIP,Description=poppy-lora-training-owner}]" \
    2>/dev/null && echo "  opened :$PORT to $MYIP" || echo "  :$PORT rule already exists (skipped)"
done

echo "== [3/7] Resolve AMI =="
AMI=$(aws_ ssm get-parameter --name "$AMI_SSM_PARAM" \
  --query "Parameter.Value" --output text)
echo "  ami=$AMI"

echo "== [4/7] Render user-data =="
UD=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  for v in REALVISXL_MODEL_URL JUGGERNAUT_MODEL_URL HF_TOKEN CIVITAI_TOKEN \
            IDLE_MINUTES S3_BUCKET AWS_REGION COMFYUI_IMAGE; do
    printf 'export %s=%q\n' "$v" "${!v}"
  done
  tail -n +2 "$(pwd)/user-data.sh"
} > "$UD"
echo "  rendered $(wc -l < "$UD") lines"

echo "== [5/7] Launch $INSTANCE_TYPE =="
IID=$(aws_ ec2 run-instances \
  --image-id "$AMI" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --instance-initiated-shutdown-behavior "$SHUTDOWN_BEHAVIOR" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$EBS_SIZE_GB,VolumeType=gp3,DeleteOnTermination=true}" \
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
  --user-data "file://$UD" \
  --tag-specifications \
    "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT},{Key=Project,Value=$PROJECT}]" \
    "ResourceType=volume,Tags=[{Key=Name,Value=$PROJECT-ebs},{Key=Project,Value=$PROJECT}]" \
  --query "Instances[0].InstanceId" --output text)
rm -f "$UD"
echo "  instance=$IID"

echo "== [6/7] Attach IAM instance profile =="
aws_ ec2 wait instance-running --instance-ids "$IID"
aws_ ec2 associate-iam-instance-profile \
  --instance-id "$IID" \
  --iam-instance-profile "Name=$IAM_PROFILE_NAME" >/dev/null
echo "  profile $IAM_PROFILE_NAME attached"

echo "== [7/7] Record state =="
IP=$(aws_ ec2 describe-instances --instance-ids "$IID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
{ echo "INSTANCE_ID=$IID"; echo "PUBLIC_IP=$IP"; echo "SUBNET_ID=$SUBNET_ID"; } > "$VSTATE"
echo "  state written -> $VSTATE"
echo ""
echo "== done: instance=$IID ip=$IP =="
echo ""
echo "The box is now provisioning (user-data downloads models; takes 15-30 min on first boot)."
echo "Check readiness:  ./status.sh"
echo "SSH:              ssh -i ${KEY_PEM} ubuntu@${IP}"
echo "Training API:     http://${IP}:8282/health  (once user-data completes)"
echo ""
echo "After the box is ready, set these env vars on the backend:"
echo "  POPPY_TRAINING_URL=http://${IP}:8282"
echo "  POPPY_ARCFACE_URL=http://${IP}:8184"
echo "  POPPY_CAPTION_URL=http://${IP}:8185"
