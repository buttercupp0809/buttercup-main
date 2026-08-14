#!/usr/bin/env bash
# 12-deploy-frontend.sh  [--yes]
# Trigger an AWS Amplify production build (RELEASE) for the frontend and poll it
# to completion.
#
# Usage:
#   ./12-deploy-frontend.sh [--yes]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
need AMPLIFY_APP_ID

log "Amplify app=$AMPLIFY_APP_ID branch=$AMPLIFY_BRANCH region=$AMPLIFY_REGION"
confirm "START an Amplify RELEASE build for app '$AMPLIFY_APP_ID' branch '$AMPLIFY_BRANCH'"

# ---- Kick off the release job -----------------------------------------------
JOB_ID="$(aws amplify start-job \
  --region "$AMPLIFY_REGION" \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name "$AMPLIFY_BRANCH" \
  --job-type RELEASE \
  --query 'jobSummary.jobId' \
  --output text)"
ok "started Amplify job $JOB_ID"

# ---- Poll until terminal -----------------------------------------------------
log "Polling job $JOB_ID until it succeeds or fails ..."
while true; do
  STATUS="$(aws amplify get-job \
    --region "$AMPLIFY_REGION" \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$AMPLIFY_BRANCH" \
    --job-id "$JOB_ID" \
    --query 'job.summary.status' \
    --output text)"
  case "$STATUS" in
    SUCCEED)
      ok "Amplify job $JOB_ID SUCCEEDED"
      exit 0 ;;
    FAILED|CANCELLED)
      die "Amplify job $JOB_ID ended: $STATUS" ;;
    *)
      printf "  status=%s ...\n" "$STATUS"
      sleep 10 ;;
  esac
done
