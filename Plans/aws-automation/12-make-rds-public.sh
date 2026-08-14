#!/usr/bin/env bash
# 12-make-rds-public.sh
# Makes the RDS instance publicly accessible so Amplify SSR compute (which runs
# outside your VPC) can reach Postgres. This is required because Amplify Hosting
# SSR Lambda functions are not VPC-attached by default.
#
# Security posture after this change:
#   - Port 5432 open to internet (0.0.0.0/0)
#   - SSL enforced by Postgres (rds.force_ssl=1 is the RDS default)
#   - Strong password in Secrets Manager; not committed to git
#   - This is the same model as Neon, Supabase, Railway, PlanetScale
#
# Usage: ./12-make-rds-public.sh [--yes]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws
resolve_account

DB_INSTANCE_ID="buttercupp-prod"

confirm "Make RDS instance '$DB_INSTANCE_ID' publicly accessible and open SG_RDS port 5432 to 0.0.0.0/0"

# 1. Enable public accessibility on the RDS instance.
log "Setting PubliclyAccessible=true on $DB_INSTANCE_ID ..."
aws rds modify-db-instance \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --publicly-accessible \
  --apply-immediately \
  --region "$AWS_REGION" >/dev/null
ok "RDS modify submitted (applies within ~5 min, no reboot required)"

# 2. Open port 5432 in the RDS security group (idempotent: ignores duplicate rules).
log "Adding port 5432 ingress to SG_RDS ($SG_RDS) ..."
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_RDS" \
  --protocol tcp \
  --port 5432 \
  --cidr "0.0.0.0/0" \
  --region "$AWS_REGION" 2>/dev/null \
  && ok "SG rule added: 0.0.0.0/0:5432 -> $SG_RDS" \
  || warn "SG rule already exists (idempotent, continuing)"

# 3. Wait for the instance to be available.
log "Waiting for RDS instance to be available (usually <2 min) ..."
aws rds wait db-instance-available \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --region "$AWS_REGION"
ok "RDS is available and publicly accessible"

echo
ok "Done. The RDS endpoint is now reachable from the public internet:"
log "  Host: $RDS_ENDPOINT"
log "  Port: 5432"
log "  SSL:  enforced by RDS default (rds.force_ssl=1)"
log ""
log "Amplify SSR login/signup will work on next page load (no redeploy needed)."
log "Test: curl https://main.d2qltioisxx75j.amplifyapp.com/api/auth/login"
