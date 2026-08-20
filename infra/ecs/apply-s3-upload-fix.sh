#!/usr/bin/env bash
# One-shot prod fix: force POPPY_DISABLE_S3_UPLOAD=false on the api + worker
# ECS services so canUploadToS3() returns true and generated chat images are
# uploaded to S3 (persist across reload) instead of the base64 fallback.
# dotenv (backend/src/load-env.ts) does NOT override platform env, so setting
# it here wins over the value baked into the image. No image rebuild needed.
set -euo pipefail
export AWS_REGION="${AWS_REGION:-eu-north-1}"
CLUSTER="buttercupp-prod"

fix_service() {
  local SERVICE="$1"
  echo "=== $SERVICE ==="
  local TD
  TD="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
        --query 'services[0].taskDefinition' --output text)"
  echo "current task def: $TD"
  # Pull the definition, inject/replace the env var, strip read-only fields.
  aws ecs describe-task-definition --task-definition "$TD" \
    --query 'taskDefinition' --output json \
  | jq '
      .containerDefinitions[0].environment =
        ((.containerDefinitions[0].environment // [])
          | map(select(.name != "POPPY_DISABLE_S3_UPLOAD"))
          + [{"name":"POPPY_DISABLE_S3_UPLOAD","value":"false"}])
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
            .compatibilities, .registeredAt, .registeredBy)
    ' > /tmp/${SERVICE}-newdef.json
  local NEWARN
  NEWARN="$(aws ecs register-task-definition --cli-input-json file:///tmp/${SERVICE}-newdef.json \
            --query 'taskDefinition.taskDefinitionArn' --output text)"
  echo "registered: $NEWARN"
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$NEWARN" --force-new-deployment \
    --query 'service.deployments[0].{status:rolloutState,taskDef:taskDefinition}' --output json
  echo "service $SERVICE rolling to new revision."
}

fix_service "buttercupp-api"
fix_service "buttercupp-worker"
echo "Done. Wait ~1-2 min for tasks to roll, then generate an image and refresh."
