#!/usr/bin/env bash
# Route 53 DNS helper for ButterCupp.
#
# Automates the DNS toil that steps 04 (CloudFront) and 05 (ALB) leave you with:
#   1. ACM validation CNAMEs  -> so the api + media certificates go ISSUED
#   2. api.buttercupp.fun     -> A-ALIAS to the ALB
#   3. media.buttercupp.fun   -> A-ALIAS to the CloudFront distribution
#
# The www + apex records are NOT created here: Amplify's custom-domain
# association (07-provision-amplify.sh) writes those into the hosted zone
# itself, including its own certificate validation.
#
# Usage:
#   ./08-provision-dns.sh              # validation records + api + media (with confirm)
#   ./08-provision-dns.sh validation   # only the ACM validation CNAMEs
#   ./08-provision-dns.sh records       # only the api + media alias records
#   ./08-provision-dns.sh --yes         # skip the confirm prompt

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
require_cmds aws jq

# CloudFront's fixed global hosted-zone id for A-ALIAS targets (same for all
# distributions, documented by AWS).
CF_ALIAS_ZONE="Z2FDTNDATAQYW2"

MODE="all"
for a in "$@"; do
  case "$a" in
    validation|records|all) MODE="$a" ;;
  esac
done

# Resolve the Route 53 hosted zone id for the root domain.
resolve_zone() {
  local zid
  zid="$(aws route53 list-hosted-zones-by-name --dns-name "${ROOT_DOMAIN}." \
        --query "HostedZones[?Name=='${ROOT_DOMAIN}.'].Id | [0]" --output text 2>/dev/null || true)"
  [ -n "$zid" ] && [ "$zid" != "None" ] || die "no Route 53 hosted zone found for ${ROOT_DOMAIN} (is the domain in this account's Route 53?)"
  echo "${zid#/hostedzone/}"
}

# Upsert one record into the zone. Args: zone_id, json-of-a-single-ResourceRecordSet
upsert() {
  local zone="$1" rrset="$2"
  local batch
  batch="$(jq -n --argjson r "$rrset" '{Changes:[{Action:"UPSERT",ResourceRecordSet:$r}]}')"
  aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch "$batch" \
    --query 'ChangeInfo.Status' --output text >/dev/null
}

# Look up an ACM cert by domain in a region and print "name<TAB>value" of its
# DNS validation record (empty if the cert or record is not found yet).
acm_validation_record() {
  local region="$1" domain="$2" arn
  arn="$(aws acm list-certificates --region "$region" \
        --query "CertificateSummaryList[?DomainName=='${domain}'].CertificateArn | [0]" --output text 2>/dev/null || true)"
  [ -n "$arn" ] && [ "$arn" != "None" ] || { return 0; }
  aws acm describe-certificate --region "$region" --certificate-arn "$arn" \
    --query "Certificate.DomainValidationOptions[?DomainName=='${domain}'].ResourceRecord | [0].[Name,Value]" \
    --output text 2>/dev/null | grep -v '^None' || true
}

do_validation() {
  local zone="$1"
  log "Adding ACM DNS-validation records"
  local pair name value
  for spec in "${AWS_REGION}::${API_HOST}" "${CLOUDFRONT_ACM_REGION}::${MEDIA_HOST}"; do
    local region="${spec%%::*}" domain="${spec##*::}"
    pair="$(acm_validation_record "$region" "$domain")"
    if [ -z "$pair" ]; then
      warn "no ACM cert / validation record yet for ${domain} in ${region} (run step 04/05 first) - skipping"
      continue
    fi
    name="$(printf '%s' "$pair" | awk '{print $1}')"
    value="$(printf '%s' "$pair" | awk '{print $2}')"
    upsert "$zone" "$(jq -n --arg n "$name" --arg v "$value" \
      '{Name:$n,Type:"CNAME",TTL:300,ResourceRecords:[{Value:$v}]}')"
    ok "validation CNAME for ${domain}: ${name} -> ${value}"
  done
}

do_records() {
  local zone="$1"

  # api.buttercupp.fun -> ALB (A-ALIAS)
  if [ "${ALB_ARN:-FILL}" = "FILL" ]; then
    warn "ALB_ARN not set - skipping ${API_HOST} (run 05-provision-alb.sh, paste ALB_ARN into config.env)"
  else
    local alb_dns alb_zone
    read -r alb_dns alb_zone < <(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
      --load-balancer-arns "$ALB_ARN" \
      --query 'LoadBalancers[0].[DNSName,CanonicalHostedZoneId]' --output text)
    [ -n "$alb_dns" ] || die "could not resolve ALB DNS from ALB_ARN"
    upsert "$zone" "$(jq -n --arg n "${API_HOST}." --arg d "$alb_dns" --arg z "$alb_zone" \
      '{Name:$n,Type:"A",AliasTarget:{HostedZoneId:$z,DNSName:$d,EvaluateTargetHealth:false}}')"
    ok "${API_HOST} -> ${alb_dns} (ALB alias)"
  fi

  # media.buttercupp.fun -> CloudFront (A-ALIAS)
  if [ "${CLOUDFRONT_DOMAIN:-FILL}" = "FILL" ]; then
    warn "CLOUDFRONT_DOMAIN not set - skipping ${MEDIA_HOST} (run 04-provision-cloudfront.sh, paste CLOUDFRONT_DOMAIN into config.env)"
  else
    upsert "$zone" "$(jq -n --arg n "${MEDIA_HOST}." --arg d "$CLOUDFRONT_DOMAIN" --arg z "$CF_ALIAS_ZONE" \
      '{Name:$n,Type:"A",AliasTarget:{HostedZoneId:$z,DNSName:$d,EvaluateTargetHealth:false}}')"
    ok "${MEDIA_HOST} -> ${CLOUDFRONT_DOMAIN} (CloudFront alias)"
  fi
}

ZONE="$(resolve_zone)"
log "Hosted zone for ${ROOT_DOMAIN}: ${ZONE}"

confirm "UPSERT Route 53 records in zone ${ZONE} (${ROOT_DOMAIN}) [mode=${MODE}]. www/apex are left to Amplify (step 07)."

case "$MODE" in
  validation) do_validation "$ZONE" ;;
  records)    do_records "$ZONE" ;;
  all)        do_validation "$ZONE"; do_records "$ZONE" ;;
esac

ok "DNS done. Certs may take a few minutes to reach ISSUED; alias records propagate quickly."
