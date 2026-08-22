#!/usr/bin/env bash
# 13d-patch-all-dodo-secrets.sh
#
# THE definitive fix for "Checkout unavailable: no_provider".
#
# Root cause (confirmed via GET /billing/provider-status on 2026-08-22):
#   The live ECS api task definition (revision 24) was MISSING every DODO
#   secret except DODO_PRODUCT_SUB_MONTHLY / DODO_PRODUCT_SUB_YEARLY (which an
#   earlier one-off patch added). Critically DODO_API_KEY was absent, so the
#   Dodo adapter's isConfigured() returned false, the provider was skipped, and
#   the chain returned no_provider.
#
#   Why the gap persisted: 11-deploy-backend.sh and 13-set-env-vars.sh both
#   re-register from the LIVE task definition (describe-task-definition); they
#   never read infra/ecs/task-api.json. So the DODO secret references added to
#   that repo file were never applied to ECS. Re-deploying the image did not
#   help because the image was never the problem.
#
# All nine secrets already EXIST in Secrets Manager; this script only wires the
# missing ones into the task definition, registers a new revision, and rolls the
# api service. It is idempotent: already-present secrets are left untouched.
#
# Usage:
#   ./13d-patch-all-dodo-secrets.sh            # interactive
#   ./13d-patch-all-dodo-secrets.sh --yes      # non-interactive
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq

# The full set of DODO secrets the api container needs. All must already exist
# in Secrets Manager (verified below before any task-def mutation).
DODO_KEYS=(
  DODO_API_KEY
  DODO_WEBHOOK_KEY
  DODO_ENVIRONMENT
  DODO_PRODUCT_DAILY
  DODO_PRODUCT_WEEKLY
  DODO_PRODUCT_MONTHLY
  DODO_PRODUCT_PACK_100
  DODO_PRODUCT_PACK_500
  DODO_PRODUCT_PACK_2000
  DODO_PRODUCT_SUB_MONTHLY
  DODO_PRODUCT_SUB_YEARLY
)

# --- 1. Verify every secret exists (a bad ARN would stop the task launching) --
log "Verifying all DODO secrets exist in Secrets Manager ..."
missing=()
for key in "${DODO_KEYS[@]}"; do
  if ! aws secretsmanager describe-secret --region "$AWS_REGION" \
        --secret-id "${SECRET_PREFIX}/${key}" >/dev/null 2>&1; then
    missing+=("$key")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  die "these secrets are missing in Secrets Manager (run 03-provision-secrets.sh first): ${missing[*]}"
fi
ok "all ${#DODO_KEYS[@]} DODO secrets exist"

# --- 2. Fetch the live task definition ---------------------------------------
log "Fetching live task definition for ${TASK_FAMILY_API} ..."
current_td="$(aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$TASK_FAMILY_API" \
  --query 'taskDefinition' \
  --output json)"

live_rev="$(echo "$current_td" | jq -r '.revision')"
log "Live revision: $live_rev"

# --- 3. Compute which keys are missing from the task def ----------------------
present="$(echo "$current_td" | jq -r '[.containerDefinitions[].secrets[].name] | unique | .[]')"
to_add=()
for key in "${DODO_KEYS[@]}"; do
  if ! grep -qx "$key" <<<"$present"; then
    to_add+=("$key")
  fi
done

if [ "${#to_add[@]}" -eq 0 ]; then
  ok "task definition already has every DODO secret; nothing to do"
  exit 0
fi

log "Will ADD ${#to_add[@]} missing secret(s) to the api container:"
printf '  %s\n' "${to_add[@]}"

confirm "Register a new ${TASK_FAMILY_API} task-def revision with these secrets and roll ${ECS_SERVICE_API}"

# --- 4. Build the new task definition JSON -----------------------------------
# Append each missing secret to the FIRST container definition (the api
# container). valueFrom uses the suffix-less ARN, matching the existing entries.
add_json="[]"
for key in "${to_add[@]}"; do
  arn="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_PREFIX}/${key}"
  add_json="$(jq --arg n "$key" --arg v "$arn" '. + [{"name":$n,"valueFrom":$v}]' <<<"$add_json")"
done

new_td="$(echo "$current_td" | jq --argjson add "$add_json" '
  (.containerDefinitions[0].secrets) |= (. + $add)
  | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
        .compatibilities, .registeredAt, .registeredBy)
')"

# Sanity: confirm DODO_API_KEY is now present in the payload before registering.
if ! echo "$new_td" | jq -e '.containerDefinitions[0].secrets[] | select(.name=="DODO_API_KEY")' >/dev/null; then
  die "internal error: DODO_API_KEY still absent in the new task def payload; aborting"
fi

# --- 5. Register + roll ------------------------------------------------------
log "Registering new task definition revision ..."
new_arn="$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "$new_td" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"
ok "Registered $new_arn"

log "Rolling ${ECS_SERVICE_API} to the new revision ..."
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE_API" \
  --task-definition "$new_arn" \
  >/dev/null
ok "update-service issued"

log "Waiting for ${ECS_SERVICE_API} to stabilize (2-3 min) ..."
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE_API"
ok "Service stable."

echo
log "Verify with:  curl https://api.buttercupp.fun/billing/provider-status"
log "Expect: dodoConfigured=true and every product=true"
