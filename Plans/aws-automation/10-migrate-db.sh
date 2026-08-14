#!/usr/bin/env bash
# 10-migrate-db.sh
# Apply Prisma migrations to the PRODUCTION RDS instance.
#
# What it does:
#   - builds DATABASE_URL from RDS_ENDPOINT + DB_NAME + DB_USER + a password
#     (taken from the PGPASSWORD env var, or prompted for) with sslmode=require
#   - one-time (idempotent) CREATE EXTENSION IF NOT EXISTS vector;  (pgvector)
#   - runs `npx prisma migrate deploy` from packages/database
#   - prints the resulting migration status
#
# This is a MUTATION against a non-local database: it confirms first.
#
# Usage:
#   PGPASSWORD=... ./10-migrate-db.sh [--yes]
#   ./10-migrate-db.sh            # will prompt for the DB password
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws npx psql
need RDS_ENDPOINT

# ---- Resolve the DB password ------------------------------------------------
# Prefer PGPASSWORD from the environment; otherwise prompt (silently).
if [ -z "${PGPASSWORD:-}" ]; then
  printf "Password for %s@%s (db %s): " "$DB_USER" "$RDS_ENDPOINT" "$DB_NAME"
  read -rs PGPASSWORD
  echo
  [ -n "$PGPASSWORD" ] || die "no DB password supplied"
fi
export PGPASSWORD

# URL-encode the password so special chars survive the DATABASE_URL.
enc_pw="$(printf '%s' "$PGPASSWORD" | jq -sRr @uri)"

# host:5432/<db> with SSL required (RDS enforces TLS in prod).
export DATABASE_URL="postgresql://${DB_USER}:${enc_pw}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require"

log "Target database: ${DB_USER}@${RDS_ENDPOINT}:5432/${DB_NAME} (sslmode=require)"

confirm "Apply Prisma migrations (migrate deploy) + ensure pgvector on RDS ${RDS_ENDPOINT}/${DB_NAME}"

# ---- 1. Ensure pgvector extension (idempotent) ------------------------------
log "Ensuring pgvector extension exists ..."
psql "host=${RDS_ENDPOINT} port=5432 dbname=${DB_NAME} user=${DB_USER} sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
ok "pgvector extension present"

# ---- 2. Apply migrations ----------------------------------------------------
cd "$REPO_ROOT/packages/database"
log "Running: npx prisma migrate deploy (cwd: $(pwd))"
npx prisma migrate deploy
ok "migrate deploy completed"

# ---- 3. Report status -------------------------------------------------------
log "Migration status:"
npx prisma migrate status || warn "prisma migrate status returned non-zero (see output above)"
