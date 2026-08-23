#!/usr/bin/env bash
# Provision the poppy-video g6e box: create a subnet in a g6e-capable AZ inside
# the existing VPC, ensure owner IP is allowed on 22/8188, launch one g6e.xlarge
# with the Wan user-data, and record ids to .state. Idempotent-ish: re-running
# after a partial failure may create duplicate subnets (check .state first).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh
aws_() { aws --region "$AWS_REGION" "$@"; }

echo "== 1. subnet in $AZ =="
SUBNET_ID=$(aws_ ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$SUBNET_CIDR" \
  --availability-zone "$AZ" --query "Subnet.SubnetId" --output text)
aws_ ec2 modify-subnet-attribute --subnet-id "$SUBNET_ID" --map-public-ip-on-launch
aws_ ec2 associate-route-table --route-table-id "$ROUTE_TABLE_ID" --subnet-id "$SUBNET_ID" >/dev/null
aws_ ec2 create-tags --resources "$SUBNET_ID" --tags Key=Project,Value="$PROJECT" >/dev/null
echo "subnet=$SUBNET_ID"

echo "== 2. allow my IP on 22 + 8188 (best-effort) =="
MYIP="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
for p in 22 8188; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=poppy-video-owner}]" 2>/dev/null || true
done

echo "== 3. launch g6e.xlarge =="
IID=$(aws_ ec2 run-instances --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
  --associate-public-ip-address \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$EBS_SIZE_GB,VolumeType=gp3,DeleteOnTermination=true}" \
  --user-data "file://user-data.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT},{Key=Project,Value=$PROJECT}]" \
  --query "Instances[0].InstanceId" --output text)
echo "instance=$IID"

echo "== 4. wait for running =="
aws_ ec2 wait instance-running --instance-ids "$IID"
IP=$(aws_ ec2 describe-instances --instance-ids "$IID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)

{ echo "SUBNET_ID=$SUBNET_ID"; echo "INSTANCE_ID=$IID"; echo "PUBLIC_IP=$IP"; } > "$VSTATE"
echo "== done =="
echo "instance=$IID ip=$IP"
echo "ComfyUI will be at http://$IP:8188 once user-data finishes downloading ~35GB of models (10-20 min)."
