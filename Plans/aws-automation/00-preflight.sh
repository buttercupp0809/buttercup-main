#!/usr/bin/env bash
# 00-preflight.sh
# Read-only sanity check before any provisioning. NO mutations happen here.
#
# What it does:
#   - verifies the required CLIs are installed (aws, docker, jq)
#   - resolves the active AWS account id from your credentials
#   - prints the resolved account / region / domains
#   - prints a checklist of every resource the later scripts will create
#   - checks that the 3 S3 buckets already exist (head-bucket) and warns if not
#
# Usage:
#   ./00-preflight.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws docker jq
resolve_account

log "Resolved deployment target:"
printf "  AWS_ACCOUNT_ID   = %s\n" "$AWS_ACCOUNT_ID"
printf "  AWS_REGION       = %s\n" "$AWS_REGION"
printf "  CLOUDFRONT_ACM   = %s (ACM certs for CloudFront live here)\n" "$CLOUDFRONT_ACM_REGION"
printf "  ROOT_DOMAIN      = %s\n" "$ROOT_DOMAIN"
printf "  FRONTEND_HOST    = %s\n" "$FRONTEND_HOST"
printf "  API_HOST         = %s\n" "$API_HOST"
printf "  MEDIA_HOST       = %s\n" "$MEDIA_HOST"
printf "  ECR image        = %s\n" "$(ecr_uri)"

echo
log "Provisioning checklist (run scripts in order; each gates with confirm):"
cat <<'EOF'
  01-provision-foundation  : default VPC discovery, 4 security groups, ECR repo,
                             CloudWatch log groups, 3 IAM roles.
  02-provision-data        : RDS Postgres 16 instance + subnet group,
                             ElastiCache Redis single node + subnet group.
  03-provision-secrets     : Secrets Manager entries buttercupp/<KEY> from secrets.env.
  04-provision-cloudfront  : ACM cert (us-east-1), OAC, CloudFront distribution over
                             the 3 S3 buckets, signing public key + key group,
                             S3 bucket policies for the OAC.
  05-provision-alb         : ACM cert (eu-north-1), internet-facing ALB, target group,
                             HTTPS:443 + HTTP:80->443 listeners, stickiness, idle timeout.
  06-provision-ecs         : ECS cluster, api + worker task definitions, api + worker services.
  07-provision-amplify     : Amplify app (WEB_COMPUTE), branch, env vars, custom domain.
EOF

echo
log "Checking that the 3 S3 buckets already exist ..."
buckets_ok=true
for b in "$S3_BUCKET" "$S3_BUCKET_GENERATED" "$S3_BUCKET_REELS"; do
  if aws s3api head-bucket --bucket "$b" 2>/dev/null; then
    ok "bucket exists: s3://$b"
  else
    warn "bucket MISSING or not accessible: s3://$b (create it before 04-provision-cloudfront.sh)"
    buckets_ok=false
  fi
done

echo
if [ "$buckets_ok" = true ]; then
  ok "Preflight passed. All 3 buckets present. You may run 01-provision-foundation.sh."
else
  warn "Preflight finished with warnings. Fix the missing buckets before provisioning CloudFront."
fi
