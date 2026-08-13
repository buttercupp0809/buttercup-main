#!/usr/bin/env bash
# ============================================================
# 65-router-destroy - remove the router control plane only.
# Leaves the GPU stack (10-deploy) intact. Use 50-destroy for that.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
require_state
FN="$ROUTER_NAME"
ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)

PREWARM="$(state_get PREWARM_SCHED)"; STOPSCHED="$(state_get STOP_SCHED)"
[[ -n "$PREWARM"  ]] && { log "delete schedule $PREWARM";  aws_ scheduler delete-schedule --name "$PREWARM" 2>/dev/null || true; }
[[ -n "$STOPSCHED" ]] && { log "delete schedule $STOPSCHED"; aws_ scheduler delete-schedule --name "$STOPSCHED" 2>/dev/null || true; }

API_ID="$(state_get API_ID)"
[[ -n "$API_ID" ]] && { log "delete HTTP API $API_ID"; aws_ apigatewayv2 delete-api --api-id "$API_ID" 2>/dev/null || true; }

[[ -n "$(state_get LAMBDA_ARN)" ]] && { log "delete Lambda $FN"; aws_ lambda delete-function --function-name "$FN" 2>/dev/null || true; }

SR="$(state_get SCHED_ROLE)"
if [[ -n "$SR" ]]; then
  log "delete scheduler role $SR"
  aws_ iam delete-role-policy --role-name "$SR" --policy-name invoke 2>/dev/null || true
  aws_ iam delete-role --role-name "$SR" 2>/dev/null || true
fi
LR="$(state_get LAMBDA_ROLE)"
if [[ -n "$LR" ]]; then
  log "delete lambda role $LR"
  aws_ iam delete-role-policy --role-name "$LR" --policy-name "${FN}-policy" 2>/dev/null || true
  aws_ iam delete-role --role-name "$LR" 2>/dev/null || true
fi

# clear router keys from state (leave GPU-stack keys intact)
for k in ROUTER_URL API_ID LAMBDA_ARN LAMBDA_ROLE SCHED_ROLE PREWARM_SCHED STOP_SCHED; do
  grep -v "^$k=" "$STATE_FILE" > "$STATE_FILE.tmp" 2>/dev/null || true
  mv "$STATE_FILE.tmp" "$STATE_FILE" 2>/dev/null || true
done
ok "router removed. GPU stack untouched."
