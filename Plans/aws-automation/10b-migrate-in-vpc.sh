#!/usr/bin/env bash
# 10b-migrate-in-vpc.sh
# Run `prisma migrate deploy` against the PRIVATE RDS as a one-off Fargate task.
#
# RDS is only reachable from inside the VPC, so we launch a task from the api
# task definition (which injects DATABASE_URL from Secrets Manager) and override
# the command to run the migration. The runtime image pruned the prisma CLI and
# dotenv (devDeps), and prisma.config.ts imports the (now absent) dotenv, so we:
#   - remove prisma.config.ts (prisma then auto-reads process.env.DATABASE_URL,
#     which the task already has from the injected secret), and
#   - fetch a version-matched CLI with `npx prisma@<ver>`.
# The init migration includes `CREATE EXTENSION IF NOT EXISTS vector`, so pgvector
# is set up here too. Waits for the task and tails its logs.
#
# Usage: ./10b-migrate-in-vpc.sh [--yes]
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
require_cmds aws jq
need SUBNET_IDS
need SG_ECS

PRISMA_VERSION="6.19.3"
# The repo's migration history is inconsistent (a later migration alters a column
# an earlier one never created), so `migrate deploy` fails on a fresh DB. Since
# schema.prisma is the source of truth the Prisma client is generated from, we
# default to `db push`, which makes the DB match the schema exactly (the pgvector
# extension already exists from the init migration). Pass `deploy` to instead try
# the migration sequence.
MODE="push"
for a in "$@"; do case "$a" in deploy) MODE="deploy" ;; push) MODE="push" ;; esac; done
if [ "$MODE" = "deploy" ]; then
  PRISMA_ACTION="migrate deploy --schema prisma/schema.prisma"
else
  PRISMA_ACTION="db push --schema prisma/schema.prisma --accept-data-loss --skip-generate"
fi
MIGRATE_CMD="cd /app/packages/database && rm -f prisma.config.ts && npx --yes prisma@${PRISMA_VERSION} ${PRISMA_ACTION}"

subnets_json="$(printf '%s' "$SUBNET_IDS" | jq -Rc 'split(",")')"
net_config="awsvpcConfiguration={subnets=$subnets_json,securityGroups=[\"$SG_ECS\"],assignPublicIp=ENABLED}"
overrides="$(jq -n --arg c "$MIGRATE_CMD" '{containerOverrides:[{name:"api",command:["sh","-c",$c]}]}')"

confirm "Run 'prisma ${MODE}' (schema sync) as a one-off Fargate task against RDS (${RDS_ENDPOINT})"
task_arn="$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$TASK_FAMILY_API" \
  --launch-type FARGATE \
  --network-configuration "$net_config" \
  --overrides "$overrides" \
  --started-by "buttercupp-migrate" \
  --query 'tasks[0].taskArn' --output text)"
[ -n "$task_arn" ] && [ "$task_arn" != "None" ] || die "run-task returned no task (check subnets/SG/task def)"
task_id="${task_arn##*/}"
ok "Started migration task: $task_id"

log "Waiting for it to finish (pulls image + prisma CLI, ~2-4 min) ..."
aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task_arn"

exit_code="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
reason="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
  --query 'tasks[0].stoppedReason' --output text)"

log "Migration task logs (tail):"
aws logs get-log-events --log-group-name "$LOG_GROUP_API" \
  --log-stream-name "api/api/${task_id}" \
  --query 'events[].message' --output text 2>/dev/null | tail -60 \
  || warn "no log stream yet ($LOG_GROUP_API : api/api/${task_id})"

echo
if [ "$exit_code" = "0" ]; then
  ok "Migration succeeded (exit 0). ${reason:+reason: $reason}"
else
  die "Migration failed (exit=$exit_code). reason: ${reason:-unknown} (see logs above)"
fi
