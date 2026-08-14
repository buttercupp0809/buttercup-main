#!/usr/bin/env bash
# 11-deploy-backend.sh  [full|build-only|ecs-only]  [--yes]
# Core backend deploy: build+push the image and roll the api + worker ECS
# services with a DIGEST-PINNED task definition.
#
# Modes:
#   full        (default)  build + push + roll both services
#   build-only             build + push only (no ECS change)
#   ecs-only               roll both services onto the CURRENT :latest digest
#
# CRITICAL correctness point (mirrors Pellow):
#   ECS is pinned by sha256 DIGEST, never by the :latest tag. After pushing
#   :latest we resolve its digest via `aws ecr describe-images`, rewrite the
#   task definition's container image to <ecr_uri>@sha256:<digest>, register a
#   new revision, and update-service to it. `--force-new-deployment` alone
#   re-pulls the OLD digest behind :latest and silently ships nothing new.
#
# Same image drives both services; the container dispatches on PROCESS_ROLE
# (api vs worker), which is already set in each task definition.
#
# Usage:
#   ./11-deploy-backend.sh full [--yes]
#   ./11-deploy-backend.sh build-only
#   ./11-deploy-backend.sh ecs-only --yes
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws docker jq

MODE="full"
for a in "$@"; do
  case "$a" in
    full|build-only|ecs-only) MODE="$a" ;;
    --yes) ;;  # handled by lib.sh
    *) die "unknown argument: $a (expected full|build-only|ecs-only|--yes)" ;;
  esac
done

ECR_URI="$(ecr_uri)"
log "Mode: $MODE  Image: ${ECR_URI}:latest"

# -----------------------------------------------------------------------------
# build_and_push : docker buildx (linux/amd64) -> ECR login -> tag -> push
# -----------------------------------------------------------------------------
build_and_push() {
  confirm "BUILD the backend image and PUSH ${ECR_URI}:latest to ECR"

  log "Building image (linux/amd64) from $REPO_ROOT ..."
  docker buildx build --platform linux/amd64 -t "${ECR_REPO}:latest" --load "$REPO_ROOT"
  ok "image built: ${ECR_REPO}:latest"

  log "Logging in to ECR ..."
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  ok "ECR login ok"

  log "Tagging + pushing ${ECR_URI}:latest ..."
  docker tag "${ECR_REPO}:latest" "${ECR_URI}:latest"
  docker push "${ECR_URI}:latest"
  ok "pushed ${ECR_URI}:latest"
}

# -----------------------------------------------------------------------------
# resolve_digest : print the sha256 digest currently behind the :latest tag
# -----------------------------------------------------------------------------
resolve_digest() {
  aws ecr describe-images \
    --region "$AWS_REGION" \
    --repository-name "$ECR_REPO" \
    --image-ids imageTag=latest \
    --query 'imageDetails[0].imageDigest' \
    --output text
}

# -----------------------------------------------------------------------------
# roll_service <service-name> <task-family> <digest>
#   - fetch the family's current active task def
#   - swap the container image to <ecr_uri>@sha256:<digest>
#   - strip read-only fields, register a new revision
#   - update-service to the new revision
# -----------------------------------------------------------------------------
roll_service() {
  local service="$1" family="$2" digest="$3"
  local pinned="${ECR_URI}@${digest}"

  log "[$service] resolving current task definition for family '$family' ..."
  local td_json
  td_json="$(aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$family" \
    --query 'taskDefinition' \
    --output json)"

  # Rewrite EVERY container's image to the digest-pinned reference, then drop
  # the fields register-task-definition rejects (they are server-managed).
  local new_td
  new_td="$(echo "$td_json" | jq --arg img "$pinned" '
    .containerDefinitions |= map(.image = $img)
    | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
          .compatibilities, .registeredAt, .registeredBy)
  ')"

  log "[$service] registering new task def revision pinned to $pinned ..."
  local new_arn
  new_arn="$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "$new_td" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"
  ok "[$service] registered $new_arn"

  log "[$service] update-service -> new revision ..."
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "$service" \
    --task-definition "$new_arn" \
    >/dev/null
  ok "[$service] update-service issued"
}

# -----------------------------------------------------------------------------
# roll_both : digest-pinned rollout of api + worker onto the current :latest
# -----------------------------------------------------------------------------
roll_both() {
  local digest
  digest="$(resolve_digest)"
  [ -n "$digest" ] && [ "$digest" != "None" ] || die "could not resolve digest for ${ECR_URI}:latest (push an image first)"
  log "Pinning rollout to digest: $digest"

  confirm "ROLL ECS services '$ECS_SERVICE_API' and '$ECS_SERVICE_WORKER' onto ${ECR_URI}@${digest}"

  roll_service "$ECS_SERVICE_API"    "$TASK_FAMILY_API"    "$digest"
  roll_service "$ECS_SERVICE_WORKER" "$TASK_FAMILY_WORKER" "$digest"

  log "Waiting for both services to reach a stable state (this can take a few minutes) ..."
  aws ecs wait services-stable \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE_API" "$ECS_SERVICE_WORKER"
  ok "both services stable"

  poll_health
}

# -----------------------------------------------------------------------------
# poll_health : hit the ALB health endpoint until it responds (or give up)
# -----------------------------------------------------------------------------
poll_health() {
  local url="https://${API_HOST}${HEALTH_PATH}"
  local fallback=""
  if [ "${ALB_DNS:-FILL}" != "FILL" ]; then
    fallback="http://${ALB_DNS}${HEALTH_PATH}"
  fi

  log "Polling backend health: $url"
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      ok "health OK: $url"
      return 0
    fi
    if [ -n "$fallback" ] && curl -fsS --max-time 5 "$fallback" >/dev/null 2>&1; then
      ok "health OK (via ALB DNS): $fallback"
      return 0
    fi
    sleep 5
  done
  warn "health check did not pass after ~150s. Investigate with 14-health-check.sh / 15-sanity-check.sh."
  return 1
}

# ---- Dispatch ---------------------------------------------------------------
case "$MODE" in
  full)       build_and_push; roll_both ;;
  build-only) build_and_push ;;
  ecs-only)   roll_both ;;
esac

ok "11-deploy-backend.sh ($MODE) done"
