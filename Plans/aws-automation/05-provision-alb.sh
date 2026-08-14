#!/usr/bin/env bash
# 05-provision-alb.sh
# Internet-facing Application Load Balancer that fronts the ECS api service.
#
# Steps:
#   - ACM cert for $API_HOST in $AWS_REGION (regional; ALB certs are same-region).
#     Print the DNS validation CNAME.
#   - Target group ($PROJECT-api): target-type ip, HTTP:$CONTAINER_PORT,
#     health-check $HEALTH_PATH, healthy/unhealthy thresholds 2, interval 30.
#   - ALB in PUBLIC_SUBNET_IDS with SG_ALB (internet-facing).
#   - HTTPS:443 listener (cert) forwarding to the TG.
#   - HTTP:80 listener redirecting to 443.
#   - Target-group stickiness (app cookie) + ALB idle timeout 300 (WebSocket-safe).
#
# Requires (from 01): SG_ALB, PUBLIC_SUBNET_IDS, VPC_ID.
# Prints: ALB_ARN, ALB_DNS, TG_API_ARN.
#
# Usage:
#   ./05-provision-alb.sh            # interactive
#   ./05-provision-alb.sh --yes
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account
need SG_ALB
need PUBLIC_SUBNET_IDS
need VPC_ID

subnet_space="${PUBLIC_SUBNET_IDS//,/ }"
alb_name="$PROJECT-alb"
tg_name="$PROJECT-api"

# =============================================================================
# ACM cert for API_HOST (regional)
# =============================================================================
log "Ensuring ACM cert for $API_HOST in $AWS_REGION ..."
cert_arn="$(aws acm list-certificates --region "$AWS_REGION" \
  --query "CertificateSummaryList[?DomainName=='$API_HOST'].CertificateArn | [0]" \
  --output text 2>/dev/null || true)"
if [ -z "$cert_arn" ] || [ "$cert_arn" = "None" ]; then
  confirm "Request an ACM cert for $API_HOST in $AWS_REGION (DNS validation)"
  cert_arn="$(aws acm request-certificate --region "$AWS_REGION" \
    --domain-name "$API_HOST" --validation-method DNS \
    --query CertificateArn --output text)"
  ok "Requested cert: $cert_arn"
  sleep 5
else
  ok "ACM cert already exists: $cert_arn"
fi
log "DNS validation record (add this CNAME to validate the cert):"
aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$cert_arn" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json || true
cert_status="$(aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$cert_arn" \
  --query 'Certificate.Status' --output text)"
[ "$cert_status" = "ISSUED" ] || warn "cert status=$cert_status; the HTTPS listener needs an ISSUED cert. Add the CNAME above, then re-run."

# =============================================================================
# Target group
# =============================================================================
tg_arn="$(aws elbv2 describe-target-groups --names "$tg_name" \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [ -z "$tg_arn" ] || [ "$tg_arn" = "None" ]; then
  confirm "Create target group $tg_name (ip, HTTP:$CONTAINER_PORT, health $HEALTH_PATH)"
  tg_arn="$(aws elbv2 create-target-group \
    --name "$tg_name" \
    --protocol HTTP --port "$CONTAINER_PORT" \
    --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-protocol HTTP \
    --health-check-path "$HEALTH_PATH" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 2 \
    --query 'TargetGroups[0].TargetGroupArn' --output text)"
  ok "Created target group: $tg_arn"
else
  ok "Target group already exists: $tg_arn"
fi

# Stickiness (app cookie) so a client re-lands on the same task through the WS upgrade.
aws elbv2 modify-target-group-attributes \
  --target-group-arn "$tg_arn" \
  --attributes \
    Key=stickiness.enabled,Value=true \
    Key=stickiness.type,Value=app_cookie \
    Key=stickiness.app_cookie.cookie_name,Value=BUTTERCUPP_STICKY \
    Key=stickiness.app_cookie.duration_seconds,Value=3600 \
    Key=deregistration_delay.timeout_seconds,Value=60 >/dev/null
ok "Target group stickiness (app cookie) enabled"

# =============================================================================
# ALB
# =============================================================================
alb_arn="$(aws elbv2 describe-load-balancers --names "$alb_name" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
if [ -z "$alb_arn" ] || [ "$alb_arn" = "None" ]; then
  confirm "Create internet-facing ALB $alb_name in $PUBLIC_SUBNET_IDS with SG $SG_ALB"
  # shellcheck disable=SC2086
  alb_arn="$(aws elbv2 create-load-balancer \
    --name "$alb_name" \
    --type application \
    --scheme internet-facing \
    --ip-address-type ipv4 \
    --subnets $subnet_space \
    --security-groups "$SG_ALB" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
  ok "Created ALB: $alb_arn"
else
  ok "ALB already exists: $alb_arn"
fi

# Idle timeout 300s so long-lived chat WebSocket streams survive.
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn "$alb_arn" \
  --attributes Key=idle_timeout.timeout_seconds,Value=300 >/dev/null
ok "ALB idle timeout set to 300s"

alb_dns="$(aws elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" \
  --query 'LoadBalancers[0].DNSName' --output text)"

# =============================================================================
# Listeners
# =============================================================================
# HTTPS:443 -> forward to TG (only if not already present).
https_arn="$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
  --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text 2>/dev/null || true)"
if [ -z "$https_arn" ] || [ "$https_arn" = "None" ]; then
  confirm "Create HTTPS:443 listener (cert $cert_arn) forwarding to $tg_name"
  aws elbv2 create-listener \
    --load-balancer-arn "$alb_arn" \
    --protocol HTTPS --port 443 \
    --certificates "CertificateArn=$cert_arn" \
    --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
    --default-actions "Type=forward,TargetGroupArn=$tg_arn" >/dev/null
  ok "Created HTTPS:443 listener"
else
  ok "HTTPS:443 listener already exists: $https_arn"
fi

# HTTP:80 -> redirect to 443.
http_arn="$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
  --query "Listeners[?Port==\`80\`].ListenerArn | [0]" --output text 2>/dev/null || true)"
if [ -z "$http_arn" ] || [ "$http_arn" = "None" ]; then
  confirm "Create HTTP:80 listener redirecting to HTTPS:443"
  aws elbv2 create-listener \
    --load-balancer-arn "$alb_arn" \
    --protocol HTTP --port 80 \
    --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' >/dev/null
  ok "Created HTTP:80 redirect listener"
else
  ok "HTTP:80 listener already exists: $http_arn"
fi

echo
ok "ALB complete. Paste into config.env:"
cat <<EOF
  ALB_ARN=$alb_arn
  ALB_DNS=$alb_dns
  TG_API_ARN=$tg_arn
EOF
log "Point $API_HOST at $alb_dns with a DNS CNAME/ALIAS."
