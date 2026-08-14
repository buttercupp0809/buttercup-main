#!/usr/bin/env bash
# 02-provision-data.sh
# Stateful data plane:
#   - RDS Postgres 16 instance (+ subnet group), encrypted, private, 7-day backups
#   - ElastiCache Redis single-node cluster (+ subnet group)
#
# pgvector note:
#   Postgres 16 on RDS ships the `vector` extension as an available default; the
#   migrate step runs `CREATE EXTENSION IF NOT EXISTS vector;` against $DB_NAME.
#   We do NOT create the extension here (no DB connection from this script).
#
# The master password is read from the PGPASSWORD env var if set, else prompted
# (hidden). It is never printed or written to disk. Put the resulting connection
# string into Secrets Manager as buttercupp/DATABASE_URL in 03-provision-secrets.sh.
#
# Requires (from 01): SG_RDS, SG_REDIS, SUBNET_IDS.
#
# Usage:
#   PGPASSWORD='...' ./02-provision-data.sh --yes
#   ./02-provision-data.sh           # prompts for the master password
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account
need SG_RDS
need SG_REDIS
need SUBNET_IDS

# Convert the comma-separated SUBNET_IDS into a space-separated list for AWS CLI.
subnet_space="${SUBNET_IDS//,/ }"

# -----------------------------------------------------------------------------
# Master password (never echoed, never persisted here)
# -----------------------------------------------------------------------------
if [ -z "${PGPASSWORD:-}" ]; then
  printf "Enter the RDS master password for user '%s' (hidden): " "$DB_USER"
  read -rs PGPASSWORD; echo
fi
[ -n "$PGPASSWORD" ] || die "master password is empty"
[ "${#PGPASSWORD}" -ge 8 ] || die "master password must be >= 8 chars"

# =============================================================================
# RDS Postgres
# =============================================================================
rds_subnet_group="$PROJECT-db-subnets"

if aws rds describe-db-subnet-groups --db-subnet-group-name "$rds_subnet_group" >/dev/null 2>&1; then
  ok "RDS subnet group already exists: $rds_subnet_group"
else
  confirm "Create RDS subnet group $rds_subnet_group across: $SUBNET_IDS"
  # shellcheck disable=SC2086
  aws rds create-db-subnet-group \
    --db-subnet-group-name "$rds_subnet_group" \
    --db-subnet-group-description "ButterCupp RDS subnets" \
    --subnet-ids $subnet_space >/dev/null
  ok "Created RDS subnet group: $rds_subnet_group"
fi

if aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" >/dev/null 2>&1; then
  ok "RDS instance already exists: $DB_INSTANCE_ID (skipping create)"
else
  confirm "Create RDS Postgres $DB_ENGINE_VERSION instance $DB_INSTANCE_ID ($DB_INSTANCE_CLASS, ${DB_ALLOCATED_GB}GB, encrypted, private)"
  aws rds create-db-instance \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --engine postgres \
    --engine-version "$DB_ENGINE_VERSION" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --allocated-storage "$DB_ALLOCATED_GB" \
    --db-name "$DB_NAME" \
    --master-username "$DB_USER" \
    --master-user-password "$PGPASSWORD" \
    --db-subnet-group-name "$rds_subnet_group" \
    --vpc-security-group-ids "$SG_RDS" \
    --storage-type gp3 \
    --storage-encrypted \
    --backup-retention-period 7 \
    --no-publicly-accessible \
    --no-multi-az \
    --copy-tags-to-snapshot >/dev/null
  ok "RDS create requested: $DB_INSTANCE_ID"
fi

log "Waiting for RDS instance to become available (this can take several minutes) ..."
aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_ID"
rds_endpoint="$(aws rds describe-db-instances \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
ok "Set RDS_ENDPOINT=$rds_endpoint in config.env"
log "DATABASE_URL will be: postgresql://$DB_USER:<password>@$rds_endpoint:5432/$DB_NAME?sslmode=require"

# =============================================================================
# ElastiCache Redis
# =============================================================================
redis_subnet_group="$PROJECT-redis-subnets"

if aws elasticache describe-cache-subnet-groups --cache-subnet-group-name "$redis_subnet_group" >/dev/null 2>&1; then
  ok "Redis subnet group already exists: $redis_subnet_group"
else
  confirm "Create ElastiCache subnet group $redis_subnet_group across: $SUBNET_IDS"
  # shellcheck disable=SC2086
  aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name "$redis_subnet_group" \
    --cache-subnet-group-description "ButterCupp Redis subnets" \
    --subnet-ids $subnet_space >/dev/null
  ok "Created Redis subnet group: $redis_subnet_group"
fi

if aws elasticache describe-cache-clusters --cache-cluster-id "$REDIS_CLUSTER_ID" >/dev/null 2>&1; then
  ok "Redis cluster already exists: $REDIS_CLUSTER_ID (skipping create)"
else
  confirm "Create ElastiCache Redis single-node cluster $REDIS_CLUSTER_ID ($REDIS_NODE_TYPE)"
  aws elasticache create-cache-cluster \
    --cache-cluster-id "$REDIS_CLUSTER_ID" \
    --engine redis \
    --cache-node-type "$REDIS_NODE_TYPE" \
    --num-cache-nodes 1 \
    --cache-subnet-group-name "$redis_subnet_group" \
    --security-group-ids "$SG_REDIS" >/dev/null
  ok "Redis create requested: $REDIS_CLUSTER_ID"
fi

log "Waiting for Redis cluster to become available ..."
aws elasticache wait cache-cluster-available --cache-cluster-id "$REDIS_CLUSTER_ID"
redis_endpoint="$(aws elasticache describe-cache-clusters \
  --cache-cluster-id "$REDIS_CLUSTER_ID" \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' --output text)"
ok "Set REDIS_ENDPOINT=$redis_endpoint in config.env"
log "REDIS_URL will be: redis://$redis_endpoint:6379"

echo
ok "Data plane complete. Paste into config.env:"
cat <<EOF
  RDS_ENDPOINT=$rds_endpoint
  REDIS_ENDPOINT=$redis_endpoint
EOF
