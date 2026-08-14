#!/usr/bin/env bash
# 06-provision-ecs.sh
# ECS Fargate cluster, task definitions, and services.
#
# Steps:
#   - create ECS cluster $ECS_CLUSTER
#   - render infra/ecs/task-api.json and task-worker.json, substituting
#     ACCT_ID -> $AWS_ACCOUNT_ID and REGION -> $AWS_REGION, then register both
#   - api service: FARGATE, desired $API_DESIRED, subnets SUBNET_IDS + SG_ECS,
#     load balancer TG_API_ARN (container 'api' port $CONTAINER_PORT),
#     health-check grace 60
#   - worker service: FARGATE, desired $WORKER_DESIRED, no load balancer
#
# Idempotent: if a service already exists it is update-service'd (new task def +
# desired count) instead of created.
#
# Requires (from 01/05): SUBNET_IDS, SG_ECS, TG_API_ARN.
#
# Usage:
#   ./06-provision-ecs.sh            # interactive
#   ./06-provision-ecs.sh --yes
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account
need SUBNET_IDS
need SG_ECS
need TG_API_ARN

ecs_dir="$REPO_ROOT/infra/ecs"
[ -d "$ecs_dir" ] || die "missing $ecs_dir (task/service JSON templates)"

# JSON array of subnets for the awsvpcConfiguration.
subnets_json="$(printf '%s' "$SUBNET_IDS" | jq -Rc 'split(",")')"

# =============================================================================
# Cluster
# =============================================================================
cluster_status="$(aws ecs describe-clusters --clusters "$ECS_CLUSTER" \
  --query 'clusters[0].status' --output text 2>/dev/null || true)"
if [ "$cluster_status" = "ACTIVE" ]; then
  ok "ECS cluster already exists: $ECS_CLUSTER"
else
  confirm "Create ECS cluster $ECS_CLUSTER (FARGATE)"
  aws ecs create-cluster \
    --cluster-name "$ECS_CLUSTER" \
    --capacity-providers FARGATE FARGATE_SPOT \
    --settings name=containerInsights,value=enabled >/dev/null
  ok "Created ECS cluster: $ECS_CLUSTER"
fi

# =============================================================================
# Task definitions (render placeholders, then register)
# =============================================================================
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

render_and_register() {  # $1 template basename  -> echoes task def ARN
  local base="$1" src="$ecs_dir/$1" out="$tmp_dir/$1"
  [ -f "$src" ] || die "missing task template: $src"
  # Substitute placeholders. ACCT_ID is safe to replace globally. REGION must be
  # replaced ONLY in its ARN / ECR-URL / log-config contexts, never inside the
  # real secret name "AWS_REGION" (a bare global s/REGION/.../ turns AWS_REGION
  # into AWS_<region>, breaking the secret lookup), so match the delimited forms.
  sed -e "s/ACCT_ID/$AWS_ACCOUNT_ID/g" \
      -e "s/:REGION:/:$AWS_REGION:/g" \
      -e "s/\.REGION\./.$AWS_REGION./g" \
      -e "s/\"REGION\"/\"$AWS_REGION\"/g" "$src" > "$out"
  # Strip the leading _comment key so register-task-definition accepts the file.
  jq 'del(._comment)' "$out" > "$out.clean"
  aws ecs register-task-definition --cli-input-json "file://$out.clean" \
    --query 'taskDefinition.taskDefinitionArn' --output text
}

confirm "Register ECS task definitions $TASK_FAMILY_API and $TASK_FAMILY_WORKER"
api_td_arn="$(render_and_register task-api.json)"
ok "Registered task def: $api_td_arn"
worker_td_arn="$(render_and_register task-worker.json)"
ok "Registered task def: $worker_td_arn"

# =============================================================================
# Services
# =============================================================================
service_exists() {  # $1 service name
  local s
  s="$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$1" \
    --query 'services[0].status' --output text 2>/dev/null || true)"
  [ "$s" = "ACTIVE" ]
}

net_config="awsvpcConfiguration={subnets=$subnets_json,securityGroups=[\"$SG_ECS\"],assignPublicIp=ENABLED}"
# assignPublicIp=ENABLED because the default-VPC subnets have no NAT gateway; tasks
# need a public IP to reach ECR / Secrets Manager / vendor APIs.

# ---- api service ------------------------------------------------------------
if service_exists "$ECS_SERVICE_API"; then
  confirm "Update existing service $ECS_SERVICE_API (new task def, desired $API_DESIRED)"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE_API" \
    --task-definition "$TASK_FAMILY_API" \
    --desired-count "$API_DESIRED" \
    --health-check-grace-period-seconds 60 \
    --network-configuration "$net_config" >/dev/null
  ok "Updated service: $ECS_SERVICE_API"
else
  confirm "Create service $ECS_SERVICE_API (FARGATE, desired $API_DESIRED, behind TG)"
  aws ecs create-service \
    --cluster "$ECS_CLUSTER" \
    --service-name "$ECS_SERVICE_API" \
    --task-definition "$TASK_FAMILY_API" \
    --desired-count "$API_DESIRED" \
    --launch-type FARGATE \
    --network-configuration "$net_config" \
    --load-balancers "targetGroupArn=$TG_API_ARN,containerName=api,containerPort=$CONTAINER_PORT" \
    --health-check-grace-period-seconds 60 \
    --deployment-configuration "maximumPercent=200,minimumHealthyPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}" >/dev/null
  ok "Created service: $ECS_SERVICE_API"
fi

# ---- worker service (no load balancer) --------------------------------------
if service_exists "$ECS_SERVICE_WORKER"; then
  confirm "Update existing service $ECS_SERVICE_WORKER (new task def, desired $WORKER_DESIRED)"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE_WORKER" \
    --task-definition "$TASK_FAMILY_WORKER" \
    --desired-count "$WORKER_DESIRED" \
    --network-configuration "$net_config" >/dev/null
  ok "Updated service: $ECS_SERVICE_WORKER"
else
  confirm "Create service $ECS_SERVICE_WORKER (FARGATE, desired $WORKER_DESIRED, no LB)"
  aws ecs create-service \
    --cluster "$ECS_CLUSTER" \
    --service-name "$ECS_SERVICE_WORKER" \
    --task-definition "$TASK_FAMILY_WORKER" \
    --desired-count "$WORKER_DESIRED" \
    --launch-type FARGATE \
    --network-configuration "$net_config" \
    --deployment-configuration "maximumPercent=200,minimumHealthyPercent=0,deploymentCircuitBreaker={enable=true,rollback=true}" >/dev/null
  ok "Created service: $ECS_SERVICE_WORKER"
fi

echo
ok "ECS complete. Cluster=$ECS_CLUSTER, services=$ECS_SERVICE_API,$ECS_SERVICE_WORKER"
log "Push an image to $(ecr_uri):latest and run 'aws ecs update-service --force-new-deployment' to roll it out."
