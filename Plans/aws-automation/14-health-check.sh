#!/usr/bin/env bash
# 14-health-check.sh
# READ-ONLY. End-to-end production health snapshot. No mutations, no confirm.
#
# Checks (each prints OK / FAIL):
#   - RDS instance status              (aws rds describe-db-instances)
#   - Redis/ElastiCache status         (aws elasticache describe-*)
#   - ECS api running vs desired       (aws ecs describe-services)
#   - ECS worker running vs desired    (aws ecs describe-services)
#   - ALB target health                (aws elbv2 describe-target-health)
#   - Backend HTTP health              (curl https://API_HOST/healthz)
#   - Frontend reachable               (curl -I https://FRONTEND_HOST)
#   - Amplify prod branch status       (aws amplify get-branch)
#
# Exits non-zero if any CRITICAL check fails. Non-critical checks (skipped
# because a FILL value is unset) are reported as SKIP and do not fail the run.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq curl

FAILED=0
printf "%-28s %s\n" "CHECK" "RESULT"
printf "%-28s %s\n" "----------------------------" "------"

report() { # <label> <status: OK|FAIL|SKIP> <detail>
  local label="$1" status="$2" detail="${3:-}"
  local mark
  case "$status" in
    OK)   mark="$C_GREEN OK $C_RESET" ;;
    FAIL) mark="$C_RED FAIL$C_RESET"; FAILED=$((FAILED + 1)) ;;
    SKIP) mark="$C_YELLOW SKIP$C_RESET" ;;
  esac
  printf "%-28s %b %s\n" "$label" "$mark" "$detail"
}

is_fill() { [ -z "${!1:-}" ] || [ "${!1}" = "FILL" ]; }

# ---- RDS --------------------------------------------------------------------
if RDS_STATUS="$(aws rds describe-db-instances \
    --region "$AWS_REGION" --db-instance-identifier "$DB_INSTANCE_ID" \
    --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)"; then
  if [ "$RDS_STATUS" = "available" ]; then
    report "RDS ($DB_INSTANCE_ID)" OK "$RDS_STATUS"
  else
    report "RDS ($DB_INSTANCE_ID)" FAIL "$RDS_STATUS"
  fi
else
  report "RDS ($DB_INSTANCE_ID)" FAIL "describe failed"
fi

# ---- Redis ------------------------------------------------------------------
# Try replication-group first (cluster mode / repl), fall back to cache cluster.
REDIS_STATUS="$(aws elasticache describe-replication-groups \
    --region "$AWS_REGION" --replication-group-id "$REDIS_CLUSTER_ID" \
    --query 'ReplicationGroups[0].Status' --output text 2>/dev/null || true)"
if [ -z "$REDIS_STATUS" ] || [ "$REDIS_STATUS" = "None" ]; then
  REDIS_STATUS="$(aws elasticache describe-cache-clusters \
      --region "$AWS_REGION" --cache-cluster-id "$REDIS_CLUSTER_ID" \
      --query 'CacheClusters[0].CacheClusterStatus' --output text 2>/dev/null || true)"
fi
if [ "$REDIS_STATUS" = "available" ]; then
  report "Redis ($REDIS_CLUSTER_ID)" OK "$REDIS_STATUS"
elif [ -n "$REDIS_STATUS" ] && [ "$REDIS_STATUS" != "None" ]; then
  report "Redis ($REDIS_CLUSTER_ID)" FAIL "$REDIS_STATUS"
else
  report "Redis ($REDIS_CLUSTER_ID)" FAIL "not found"
fi

# ---- ECS services -----------------------------------------------------------
check_service() {
  local service="$1"
  local json
  if ! json="$(aws ecs describe-services \
      --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$service" \
      --query 'services[0].{running:runningCount,desired:desiredCount,status:status}' \
      --output json 2>/dev/null)"; then
    report "ECS ($service)" FAIL "describe failed"
    return
  fi
  local running desired status
  running="$(echo "$json" | jq -r '.running')"
  desired="$(echo "$json" | jq -r '.desired')"
  status="$(echo "$json" | jq -r '.status')"
  if [ "$status" = "ACTIVE" ] && [ "$running" = "$desired" ] && [ "$desired" -gt 0 ] 2>/dev/null; then
    report "ECS ($service)" OK "$running/$desired running"
  else
    report "ECS ($service)" FAIL "$running/$desired running ($status)"
  fi
}
check_service "$ECS_SERVICE_API"
check_service "$ECS_SERVICE_WORKER"

# ---- ALB target health ------------------------------------------------------
if is_fill TG_API_ARN; then
  report "ALB target health" SKIP "TG_API_ARN unset"
else
  TH="$(aws elbv2 describe-target-health \
      --region "$AWS_REGION" --target-group-arn "$TG_API_ARN" \
      --query 'TargetHealthDescriptions[].TargetHealth.State' --output text 2>/dev/null || true)"
  if [ -z "$TH" ]; then
    report "ALB target health" FAIL "no targets registered"
  else
    total="$(echo "$TH" | wc -w | tr -d ' ')"
    healthy="$(echo "$TH" | tr '\t' '\n' | grep -c '^healthy$' || true)"
    if [ "$healthy" -gt 0 ] && [ "$healthy" = "$total" ]; then
      report "ALB target health" OK "$healthy/$total healthy"
    else
      report "ALB target health" FAIL "$healthy/$total healthy"
    fi
  fi
fi

# ---- Backend HTTP -----------------------------------------------------------
if curl -fsS --max-time 8 "https://${API_HOST}${HEALTH_PATH}" >/dev/null 2>&1; then
  report "Backend HTTPS ${HEALTH_PATH}" OK "https://${API_HOST}${HEALTH_PATH}"
else
  report "Backend HTTPS ${HEALTH_PATH}" FAIL "https://${API_HOST}${HEALTH_PATH}"
fi

# ---- Frontend HTTP ----------------------------------------------------------
if curl -fsSI --max-time 8 "https://${FRONTEND_HOST}" >/dev/null 2>&1; then
  report "Frontend HTTPS" OK "https://${FRONTEND_HOST}"
else
  report "Frontend HTTPS" FAIL "https://${FRONTEND_HOST}"
fi

# ---- Amplify branch ---------------------------------------------------------
if is_fill AMPLIFY_APP_ID; then
  report "Amplify branch" SKIP "AMPLIFY_APP_ID unset"
else
  AMP_STATUS="$(aws amplify get-branch \
      --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
      --query 'branch.activeJobId' --output text 2>/dev/null || true)"
  if [ -n "$AMP_STATUS" ] && [ "$AMP_STATUS" != "None" ]; then
    JOB_STATUS="$(aws amplify get-job \
        --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
        --job-id "$AMP_STATUS" --query 'job.summary.status' --output text 2>/dev/null || echo '?')"
    if [ "$JOB_STATUS" = "SUCCEED" ]; then
      report "Amplify ($AMPLIFY_BRANCH)" OK "last job $AMP_STATUS: $JOB_STATUS"
    else
      report "Amplify ($AMPLIFY_BRANCH)" FAIL "last job $AMP_STATUS: $JOB_STATUS"
    fi
  else
    report "Amplify ($AMPLIFY_BRANCH)" FAIL "no active job / branch missing"
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  ok "All critical health checks passed."
  exit 0
else
  die "$FAILED health check(s) FAILED."
fi
