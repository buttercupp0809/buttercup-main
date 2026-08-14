#!/usr/bin/env bash
# 13-set-env-vars.sh  <file.env>  [--yes]
# Update backend secrets in Secrets Manager from a KEY=VALUE file, then roll the
# api + worker ECS services so running tasks pick up the new values.
#
# For each KEY=VALUE line:
#   - put-secret-value on  buttercupp/<KEY>  (create the secret first if missing)
#
# Then, so the change actually reaches running containers, both services get a
# fresh task-definition revision (re-registered from their current def, pinned
# to the CURRENT :latest image digest) and update-service is issued. Secret
# values are read at task start, so a new revision is what makes tasks re-read.
#
# Secret VALUES are never printed.
#
# Usage:
#   ./13-set-env-vars.sh secrets.env [--yes]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq

ENV_FILE=""
for a in "$@"; do
  case "$a" in
    --yes) ;;                       # handled by lib.sh
    -*)    die "unknown flag: $a" ;;
    *)     ENV_FILE="$a" ;;
  esac
done
[ -n "$ENV_FILE" ] || die "usage: 13-set-env-vars.sh <file.env> [--yes]"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

ECR_URI="$(ecr_uri)"

# ---- Collect the keys (values kept in an array, never echoed) ---------------
KEYS=()
VALUES=()
while IFS= read -r line || [ -n "$line" ]; do
  # skip blanks and comments
  case "$line" in ''|\#*) continue ;; esac
  # require KEY=VALUE
  case "$line" in *=*) ;; *) warn "skipping malformed line (no '='): $line"; continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  # strip surrounding quotes on the value if present
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  [ -n "$key" ] || continue
  KEYS+=("$key")
  VALUES+=("$val")
done < "$ENV_FILE"

[ "${#KEYS[@]}" -gt 0 ] || die "no KEY=VALUE entries found in $ENV_FILE"

log "Will update ${#KEYS[@]} secret(s) under ${SECRET_PREFIX}/ :"
for k in "${KEYS[@]}"; do printf "  - %s/%s\n" "$SECRET_PREFIX" "$k"; done

confirm "WRITE ${#KEYS[@]} secret value(s) to Secrets Manager and ROLL both ECS services"

# ---- Upsert each secret ------------------------------------------------------
i=0
for key in "${KEYS[@]}"; do
  val="${VALUES[$i]}"
  i=$((i + 1))
  name="${SECRET_PREFIX}/${key}"

  if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --region "$AWS_REGION" \
      --secret-id "$name" \
      --secret-string "$val" \
      >/dev/null
    ok "updated secret $name"
  else
    aws secretsmanager create-secret \
      --region "$AWS_REGION" \
      --name "$name" \
      --secret-string "$val" \
      >/dev/null
    ok "created secret $name"
  fi
done

# ---- Re-register (digest-pinned) + roll both services -----------------------
# Reuse the CURRENT :latest digest so we do not accidentally change the image;
# the ONLY purpose of the new revision is to force tasks to re-read secrets.
resolve_digest() {
  aws ecr describe-images \
    --region "$AWS_REGION" \
    --repository-name "$ECR_REPO" \
    --image-ids imageTag=latest \
    --query 'imageDetails[0].imageDigest' \
    --output text
}

roll_service() {
  local service="$1" family="$2" digest="$3"
  local pinned="${ECR_URI}@${digest}"

  local td_json new_td new_arn
  td_json="$(aws ecs describe-task-definition \
    --region "$AWS_REGION" --task-definition "$family" \
    --query 'taskDefinition' --output json)"

  new_td="$(echo "$td_json" | jq --arg img "$pinned" '
    .containerDefinitions |= map(.image = $img)
    | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
          .compatibilities, .registeredAt, .registeredBy)
  ')"

  new_arn="$(aws ecs register-task-definition \
    --region "$AWS_REGION" --cli-input-json "$new_td" \
    --query 'taskDefinition.taskDefinitionArn' --output text)"
  ok "[$service] registered $new_arn"

  aws ecs update-service \
    --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
    --service "$service" --task-definition "$new_arn" >/dev/null
  ok "[$service] update-service issued"
}

DIGEST="$(resolve_digest)"
[ -n "$DIGEST" ] && [ "$DIGEST" != "None" ] || die "could not resolve current :latest digest (deploy an image first)"
log "Pinning re-roll to current digest: $DIGEST"

roll_service "$ECS_SERVICE_API"    "$TASK_FAMILY_API"    "$DIGEST"
roll_service "$ECS_SERVICE_WORKER" "$TASK_FAMILY_WORKER" "$DIGEST"

log "Waiting for both services to stabilize ..."
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE_API" "$ECS_SERVICE_WORKER"
ok "secrets updated and both services rolled"
