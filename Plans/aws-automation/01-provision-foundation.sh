#!/usr/bin/env bash
# 01-provision-foundation.sh
# Foundational, cheap-to-create infra that everything else depends on:
#   - discover the default VPC and its subnets (print VPC_ID/SUBNET_IDS/PUBLIC_SUBNET_IDS)
#   - 4 security groups (ALB, ECS, RDS, Redis) with the right ingress rules
#   - ECR repository for the container image
#   - CloudWatch log groups for api + worker
#   - 3 IAM roles: ecs-execution, api-task, worker-task
#
# Every mutating step is idempotent (describe-before-create) and gated by confirm.
# After it runs, paste the printed VPC_ID / SUBNET_IDS / PUBLIC_SUBNET_IDS / SG_* into config.env.
#
# Usage:
#   ./01-provision-foundation.sh            # interactive
#   ./01-provision-foundation.sh --yes      # auto-confirm (CI)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account

# -----------------------------------------------------------------------------
# 1. Default VPC + subnets (discovery only, no mutation)
# -----------------------------------------------------------------------------
log "Discovering the default VPC in $AWS_REGION ..."
if [ "${VPC_ID:-FILL}" != "FILL" ] && [ -n "${VPC_ID:-}" ]; then
  ok "VPC_ID already set in config.env: $VPC_ID (using it)"
  vpc_id="$VPC_ID"
else
  vpc_id="$(aws ec2 describe-vpcs \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text 2>/dev/null || true)"
  [ -n "$vpc_id" ] && [ "$vpc_id" != "None" ] || die "no default VPC found; set VPC_ID in config.env manually"
  ok "Set VPC_ID=$vpc_id in config.env"
fi

# All subnets in that VPC. The default VPC's subnets are public (they route to an IGW),
# so we use the same set for tasks+data (SUBNET_IDS) and for the ALB (PUBLIC_SUBNET_IDS).
# bash 3.2 (macOS default) has no `mapfile`; read into the array portably.
subnet_arr=()
while IFS= read -r _sn; do [ -n "$_sn" ] && subnet_arr+=("$_sn"); done < <(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$vpc_id" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')
[ "${#subnet_arr[@]}" -ge 2 ] || die "need >=2 subnets in $vpc_id, found ${#subnet_arr[@]}"
subnet_csv="$(IFS=,; echo "${subnet_arr[*]}")"
ok "Set SUBNET_IDS=$subnet_csv in config.env"
ok "Set PUBLIC_SUBNET_IDS=$subnet_csv in config.env (default VPC subnets are public)"

# -----------------------------------------------------------------------------
# Helper: find-or-create a security group, echo its id.
# -----------------------------------------------------------------------------
ensure_sg() {
  local name="$1" desc="$2" existing
  existing="$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$vpc_id" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
  if [ -n "$existing" ] && [ "$existing" != "None" ]; then
    echo "$existing"; return 0
  fi
  aws ec2 create-security-group \
    --group-name "$name" --description "$desc" --vpc-id "$vpc_id" \
    --query 'GroupId' --output text
}

# Add an ingress rule idempotently (ignore "already exists" duplicate errors).
add_ingress_cidr() {  # $1 sg  $2 proto  $3 port  $4 cidr
  aws ec2 authorize-security-group-ingress \
    --group-id "$1" --protocol "$2" --port "$3" --cidr "$4" >/dev/null 2>&1 || true
}
add_ingress_sg() {    # $1 sg  $2 proto  $3 port  $4 source-sg
  aws ec2 authorize-security-group-ingress \
    --group-id "$1" --protocol "$2" --port "$3" --source-group "$4" >/dev/null 2>&1 || true
}

confirm "Create/ensure 4 security groups (ALB, ECS, RDS, Redis) in VPC $vpc_id"

sg_alb="$(ensure_sg "$PROJECT-alb" "ButterCupp public ALB (443/80 from internet)")"
sg_ecs="$(ensure_sg "$PROJECT-ecs" "ButterCupp Fargate tasks (api+worker)")"
sg_rds="$(ensure_sg "$PROJECT-rds" "ButterCupp RDS Postgres")"
sg_redis="$(ensure_sg "$PROJECT-redis" "ButterCupp ElastiCache Redis")"

# ALB: open 443 + 80 to the world.
add_ingress_cidr "$sg_alb" tcp 443 0.0.0.0/0
add_ingress_cidr "$sg_alb" tcp 80  0.0.0.0/0
# ECS: accept container port only from the ALB SG.
add_ingress_sg   "$sg_ecs" tcp "$CONTAINER_PORT" "$sg_alb"
# RDS: Postgres only from ECS tasks.
add_ingress_sg   "$sg_rds" tcp 5432 "$sg_ecs"
# Redis: only from ECS tasks.
add_ingress_sg   "$sg_redis" tcp 6379 "$sg_ecs"

ok "Set SG_ALB=$sg_alb in config.env"
ok "Set SG_ECS=$sg_ecs in config.env"
ok "Set SG_RDS=$sg_rds in config.env"
ok "Set SG_REDIS=$sg_redis in config.env"

# -----------------------------------------------------------------------------
# 2. ECR repository
# -----------------------------------------------------------------------------
if aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  ok "ECR repo already exists: $ECR_REPO"
else
  confirm "Create ECR repository '$ECR_REPO' (immutable off, scan-on-push on)"
  aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability MUTABLE >/dev/null
  ok "Created ECR repo: $(ecr_uri)"
fi

# -----------------------------------------------------------------------------
# 3. CloudWatch log groups
# -----------------------------------------------------------------------------
ensure_log_group() {  # $1 name
  if aws logs describe-log-groups --log-group-name-prefix "$1" \
       --query "logGroups[?logGroupName=='$1'].logGroupName" --output text 2>/dev/null | grep -q "$1"; then
    ok "Log group already exists: $1"
  else
    confirm "Create CloudWatch log group $1 (retention 30 days)"
    aws logs create-log-group --log-group-name "$1" >/dev/null 2>&1 || true
    aws logs put-retention-policy --log-group-name "$1" --retention-in-days 30 >/dev/null 2>&1 || true
    ok "Created log group: $1"
  fi
}
ensure_log_group "$LOG_GROUP_API"
ensure_log_group "$LOG_GROUP_WORKER"

# -----------------------------------------------------------------------------
# 4. IAM roles
# -----------------------------------------------------------------------------
ecs_tasks_trust='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}'

# Create a role with the ecs-tasks trust policy if it does not exist.
ensure_role() {  # $1 role-name  $2 description
  if aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    ok "IAM role already exists: $1"
  else
    confirm "Create IAM role $1 (trust: ecs-tasks.amazonaws.com)"
    aws iam create-role \
      --role-name "$1" \
      --description "$2" \
      --assume-role-policy-document "$ecs_tasks_trust" >/dev/null
    ok "Created IAM role: $1"
  fi
}

secrets_arn_glob="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_PREFIX}/*"
bucket_arns_json="\"arn:aws:s3:::${S3_BUCKET}\",\"arn:aws:s3:::${S3_BUCKET}/*\",\"arn:aws:s3:::${S3_BUCKET_GENERATED}\",\"arn:aws:s3:::${S3_BUCKET_GENERATED}/*\",\"arn:aws:s3:::${S3_BUCKET_REELS}\",\"arn:aws:s3:::${S3_BUCKET_REELS}/*\""

# --- execution role: pull image, write logs, read our secrets ----------------
ensure_role "$PROJECT-ecs-execution" "ButterCupp ECS task execution role"
aws iam attach-role-policy \
  --role-name "$PROJECT-ecs-execution" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true
exec_secrets_policy="{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"secretsmanager:GetSecretValue\"],
    \"Resource\": [\"$secrets_arn_glob\"]
  }]
}"
aws iam put-role-policy \
  --role-name "$PROJECT-ecs-execution" \
  --policy-name "$PROJECT-secrets-read" \
  --policy-document "$exec_secrets_policy" >/dev/null
ok "Attached execution policies to $PROJECT-ecs-execution"

# --- task roles: S3 object rw on the 3 buckets + logs ------------------------
task_policy="{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\", \"s3:ListBucket\"],
      \"Resource\": [$bucket_arns_json]
    },
    {
      \"Effect\": \"Allow\",
      \"Action\": [\"logs:CreateLogStream\", \"logs:PutLogEvents\"],
      \"Resource\": [\"arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${PROJECT}-*\"]
    }
  ]
}"
for role in "$PROJECT-api-task" "$PROJECT-worker-task"; do
  ensure_role "$role" "ButterCupp ECS task role ($role)"
  aws iam put-role-policy \
    --role-name "$role" \
    --policy-name "$PROJECT-s3-logs" \
    --policy-document "$task_policy" >/dev/null
  ok "Attached S3+logs inline policy to $role"
done

echo
ok "Foundation complete. Paste these into config.env:"
cat <<EOF
  VPC_ID=$vpc_id
  SUBNET_IDS=$subnet_csv
  PUBLIC_SUBNET_IDS=$subnet_csv
  SG_ALB=$sg_alb
  SG_ECS=$sg_ecs
  SG_RDS=$sg_rds
  SG_REDIS=$sg_redis
EOF
