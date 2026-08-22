#!/usr/bin/env bash
# 13c-patch-sub-product-secrets.sh
#
# One-shot fix: adds DODO_PRODUCT_SUB_MONTHLY and DODO_PRODUCT_SUB_YEARLY to
# both AWS Secrets Manager and the live ECS task definition for the api service,
# then rolls the service.
#
# Root cause this fixes: the subscription plans (sub_monthly / sub_yearly) were
# added to secrets.env AFTER the ECS task definition was initially provisioned by
# 06-provision-ecs.sh. That means those two product-ID env vars were never wired
# into the task definition, so the backend always saw them as undefined, and
# resolveProductId() threw dodo_missing_product:DODO_PRODUCT_SUB_MONTHLY /
# DODO_PRODUCT_SUB_YEARLY. With no fallback providers configured, the provider
# chain returned no_provider to the frontend.
#
# What this script does:
#   1. Reads DODO_PRODUCT_SUB_MONTHLY and DODO_PRODUCT_SUB_YEARLY from secrets.env
#   2. Upserts both values into Secrets Manager under buttercupp/
#   3. Fetches the current api task definition from ECS
#   4. Appends the two new secrets entries (if not already present)
#   5. Registers a new task-definition revision
#   6. Calls update-service and waits for stabilization
#
# Usage:
#   ./13c-patch-sub-product-secrets.sh            # interactive
#   ./13c-patch-sub-product-secrets.sh --yes      # non-interactive
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq

SECRETS_FILE="$SCRIPT_DIR/secrets.env"
[ -f "$SECRETS_FILE" ] || die "missing $SECRETS_FILE"

extract_val() {
  local key="$1"
  local val
  val="$(grep -E "^${key}=" "$SECRETS_FILE" | head -1 | cut -d= -f2-)"
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  echo "$val"
}

SUB_MONTHLY_PRODUCT="$(extract_val DODO_PRODUCT_SUB_MONTHLY)"
SUB_YEARLY_PRODUCT="$(extract_val DODO_PRODUCT_SUB_YEARLY)"

[ -n "$SUB_MONTHLY_PRODUCT" ] || die "DODO_PRODUCT_SUB_MONTHLY is empty in $SECRETS_FILE"
[ -n "$SUB_YEARLY_PRODUCT" ]  || die "DODO_PRODUCT_SUB_YEARLY is empty in $SECRETS_FILE"

log "DODO_PRODUCT_SUB_MONTHLY -> (value set, not shown)"
log "DODO_PRODUCT_SUB_YEARLY  -> (value set, not shown)"
log "Targeting ECS service: ${ECS_SERVICE_API} in cluster ${ECS_CLUSTER}"

confirm "Upsert 2 Secrets Manager secrets and roll ECS api service with the new task-def revision"

# --- 1. Upsert secrets --------------------------------------------------------
upsert_secret() {
  local key="$1" val="$2"
  local name="${SECRET_PREFIX}/${key}"
  if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --region "$AWS_REGION" --secret-id "$name" --secret-string "$val" >/dev/null
    ok "updated secret $name"
  else
    aws secretsmanager create-secret \
      --region "$AWS_REGION" --name "$name" --secret-string "$val" >/dev/null
    ok "created secret $name"
  fi
}

upsert_secret "DODO_PRODUCT_SUB_MONTHLY" "$SUB_MONTHLY_PRODUCT"
upsert_secret "DODO_PRODUCT_SUB_YEARLY"  "$SUB_YEARLY_PRODUCT"

# --- 2. Patch task definition -------------------------------------------------
log "Fetching current task definition for ${TASK_FAMILY_API} ..."
current_td="$(aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$TASK_FAMILY_API" \
  --query 'taskDefinition' \
  --output json)"

SM_ARN_PREFIX="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_PREFIX}"

new_td="$(echo "$current_td" | jq \
  --arg arn_monthly "${SM_ARN_PREFIX}/DODO_PRODUCT_SUB_MONTHLY" \
  --arg arn_yearly  "${SM_ARN_PREFIX}/DODO_PRODUCT_SUB_YEARLY" '
  .containerDefinitions |= map(
    if (.secrets // []) | any(.name == "DODO_PRODUCT_SUB_MONTHLY") | not then
      .secrets += [
        {"name": "DODO_PRODUCT_SUB_MONTHLY", "valueFrom": $arn_monthly},
        {"name": "DODO_PRODUCT_SUB_YEARLY",  "valueFrom": $arn_yearly}
      ]
    else . end
  )
  | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
        .compatibilities, .registeredAt, .registeredBy)
')"

# Verify the patch actually added the entries (idempotent if already present)
count="$(echo "$new_td" | jq '[.containerDefinitions[].secrets[] | select(.name | startswith("DODO_PRODUCT_SUB_"))] | length')"
log "DODO_PRODUCT_SUB_* entries in new task def: $count"

log "Registering new task definition revision ..."
new_arn="$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "$new_td" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"
ok "Registered $new_arn"

# --- 3. Roll api service ------------------------------------------------------
log "Updating service ${ECS_SERVICE_API} to new revision ..."
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE_API" \
  --task-definition "$new_arn" \
  >/dev/null
ok "update-service issued"

log "Waiting for ${ECS_SERVICE_API} to stabilize (may take 2-3 min) ..."
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE_API"
ok "Service is stable. Subscription checkout should work now."
