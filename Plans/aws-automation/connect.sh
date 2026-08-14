#!/usr/bin/env bash
# connect.sh  <db|backend|frontend>  [logs|status|shell]
# Ops convenience for connecting to / inspecting a running target.
#
# Everything is READ-ONLY except `backend shell` (ECS Exec into a live task),
# which is gated with confirm.
#
#   db       shell   psql into RDS (PGPASSWORD env or prompt)        [default]
#   db       status  aws rds describe-db-instances summary
#
#   backend  logs    aws logs tail LOG_GROUP_API --follow            [default]
#   backend  status  aws ecs describe-services (api + worker)
#   backend  shell   aws ecs execute-command /bin/bash into an api task (confirm)
#
#   frontend logs    aws amplify list-jobs (recent) + last job detail [default]
#   frontend status  aws amplify get-branch summary
#
# Usage:
#   ./connect.sh backend logs
#   PGPASSWORD=... ./connect.sh db shell
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws

TARGET="${1:-}"
ACTION="${2:-}"
[ -n "$TARGET" ] || die "usage: connect.sh <db|backend|frontend> [logs|status|shell]"

# =============================================================================
# db
# =============================================================================
connect_db() {
  need RDS_ENDPOINT
  require_cmds psql
  local action="${1:-shell}"
  case "$action" in
    status)
      aws rds describe-db-instances \
        --region "$AWS_REGION" --db-instance-identifier "$DB_INSTANCE_ID" \
        --query 'DBInstances[0].{status:DBInstanceStatus,endpoint:Endpoint.Address,engine:EngineVersion,class:DBInstanceClass}' \
        --output table
      ;;
    shell)
      if [ -z "${PGPASSWORD:-}" ]; then
        printf "Password for %s@%s (db %s): " "$DB_USER" "$RDS_ENDPOINT" "$DB_NAME"
        read -rs PGPASSWORD; echo
        [ -n "$PGPASSWORD" ] || die "no DB password supplied"
      fi
      export PGPASSWORD
      log "psql -> ${DB_USER}@${RDS_ENDPOINT}/${DB_NAME} (sslmode=require)"
      exec psql "host=${RDS_ENDPOINT} port=5432 dbname=${DB_NAME} user=${DB_USER} sslmode=require"
      ;;
    *) die "db action must be one of: shell|status" ;;
  esac
}

# =============================================================================
# backend  (ECS api/worker)
# =============================================================================
connect_backend() {
  local action="${1:-logs}"
  case "$action" in
    logs)
      log "Tailing $LOG_GROUP_API (Ctrl-C to stop) ..."
      exec aws logs tail "$LOG_GROUP_API" --follow --region "$AWS_REGION"
      ;;
    status)
      aws ecs describe-services \
        --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE_API" "$ECS_SERVICE_WORKER" \
        --query 'services[].{name:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount}' \
        --output table
      ;;
    shell)
      require_cmds jq
      log "Finding a RUNNING task for $ECS_SERVICE_API ..."
      local task_arn
      task_arn="$(aws ecs list-tasks \
        --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
        --service-name "$ECS_SERVICE_API" --desired-status RUNNING \
        --query 'taskArns[0]' --output text)"
      [ -n "$task_arn" ] && [ "$task_arn" != "None" ] || die "no RUNNING api task found"

      # Container name = first container in the running task definition.
      local container
      container="$(aws ecs describe-tasks \
        --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
        --query 'tasks[0].containers[0].name' --output text)"

      log "Task: $task_arn  Container: $container"
      confirm "OPEN an interactive /bin/bash shell (ECS Exec) into api task $task_arn"
      exec aws ecs execute-command \
        --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
        --task "$task_arn" --container "$container" \
        --interactive --command "/bin/bash"
      ;;
    *) die "backend action must be one of: logs|status|shell" ;;
  esac
}

# =============================================================================
# frontend  (Amplify)
# =============================================================================
connect_frontend() {
  need AMPLIFY_APP_ID
  local action="${1:-logs}"
  case "$action" in
    logs)
      log "Recent Amplify jobs for $AMPLIFY_BRANCH:"
      aws amplify list-jobs \
        --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
        --max-results 10 \
        --query 'jobSummaries[].{jobId:jobId,status:status,type:jobType,commit:commitId,start:startTime}' \
        --output table
      # Detail on the most recent job.
      local last
      last="$(aws amplify list-jobs \
        --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
        --max-results 1 --query 'jobSummaries[0].jobId' --output text 2>/dev/null || true)"
      if [ -n "$last" ] && [ "$last" != "None" ]; then
        log "Latest job $last steps:"
        aws amplify get-job \
          --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
          --job-id "$last" \
          --query 'job.steps[].{step:stepName,status:status}' --output table
      fi
      ;;
    status)
      aws amplify get-branch \
        --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" --branch-name "$AMPLIFY_BRANCH" \
        --query 'branch.{branch:branchName,stage:stage,activeJob:activeJobId,enabled:enableAutoBuild}' \
        --output table
      ;;
    *) die "frontend action must be one of: logs|status" ;;
  esac
}

case "$TARGET" in
  db)       connect_db "$ACTION" ;;
  backend)  connect_backend "$ACTION" ;;
  frontend) connect_frontend "$ACTION" ;;
  *) die "unknown target: $TARGET (expected db|backend|frontend)" ;;
esac
