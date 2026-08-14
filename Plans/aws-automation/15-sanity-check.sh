#!/usr/bin/env bash
# 15-sanity-check.sh
# READ-ONLY post-deploy sanity check. Non-fatal: it reports findings and always
# exits 0 unless the AWS calls themselves cannot run. No mutations, no confirm.
#
# What it does:
#   - tails the last ~5 minutes of the api + worker CloudWatch log groups and
#     counts matches for FATAL / Prisma P20xx errors / unhandledRejection
#   - reports the ECS deployment rollout state for both services (want COMPLETED)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq

# Look-back window: 5 minutes (epoch millis).
SINCE_MS=$(( ($(date +%s) - 300) * 1000 ))

# Patterns we care about. CloudWatch filter-pattern quoting is finicky, so we
# fetch the window once and grep locally for robustness.
scan_log_group() {
  local group="$1" label="$2"
  log "Scanning $label ($group) since $(date -r $((SINCE_MS/1000)) '+%H:%M:%S') ..."

  local events
  events="$(aws logs filter-log-events \
    --region "$AWS_REGION" \
    --log-group-name "$group" \
    --start-time "$SINCE_MS" \
    --query 'events[].message' \
    --output text 2>/dev/null || true)"

  if [ -z "$events" ]; then
    ok "[$label] no log events in the last 5 min (or log group empty)"
    return
  fi

  local fatal prisma unhandled
  fatal="$(printf '%s\n' "$events"    | grep -c -E 'FATAL'            || true)"
  prisma="$(printf '%s\n' "$events"   | grep -c -E 'P20[0-9]{2}'     || true)"
  unhandled="$(printf '%s\n' "$events"| grep -c -E 'unhandledRejection' || true)"

  printf "  %-22s FATAL=%s  PrismaP20xx=%s  unhandledRejection=%s\n" \
    "$label" "$fatal" "$prisma" "$unhandled"

  if [ "$fatal" -gt 0 ] || [ "$prisma" -gt 0 ] || [ "$unhandled" -gt 0 ]; then
    warn "[$label] error signatures present in the last 5 min (samples below):"
    printf '%s\n' "$events" | grep -E 'FATAL|P20[0-9]{2}|unhandledRejection' | head -n 5 | sed 's/^/    /'
  else
    ok "[$label] clean (no FATAL / Prisma P20xx / unhandledRejection)"
  fi
}

scan_log_group "$LOG_GROUP_API"    "api"
scan_log_group "$LOG_GROUP_WORKER" "worker"

echo
# ---- ECS rollout state ------------------------------------------------------
check_rollout() {
  local service="$1"
  local state
  state="$(aws ecs describe-services \
    --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$service" \
    --query 'services[0].deployments[?status==`PRIMARY`].rolloutState | [0]' \
    --output text 2>/dev/null || true)"
  if [ "$state" = "COMPLETED" ]; then
    ok "[$service] rollout state: COMPLETED"
  elif [ -z "$state" ] || [ "$state" = "None" ]; then
    warn "[$service] rollout state unavailable"
  else
    warn "[$service] rollout state: $state (not COMPLETED yet)"
  fi
}
check_rollout "$ECS_SERVICE_API"
check_rollout "$ECS_SERVICE_WORKER"

echo
ok "Sanity check complete (informational; review any WARN lines above)."
