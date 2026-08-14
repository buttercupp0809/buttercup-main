#!/usr/bin/env bash
# 04-provision-cloudfront.sh
# CloudFront signed-URL delivery over the (private) S3 media buckets.
#
# Steps:
#   (a) ACM cert for $MEDIA_HOST in us-east-1 (CloudFront certs MUST live there);
#       print the DNS validation CNAME and continue (do not block forever).
#   (b) Origin Access Control (OAC) so CloudFront can read the private buckets.
#   (c) CloudFront distribution with 3 S3 origins:
#          default behavior      -> $S3_BUCKET (character-media)
#          path pattern images/* -> $S3_BUCKET_GENERATED (generated)
#          path pattern reels/*  -> $S3_BUCKET_REELS
#       viewer-protocol redirect-to-https, alias $MEDIA_HOST + the ACM cert.
#   (d) CloudFront public key + key group from cloudfront_signing_public_key.pem,
#       attached as a trusted key group on the default behavior (enables signed URLs).
#   (e) S3 bucket policies granting the OAC (cloudfront.amazonaws.com, SourceArn =
#       this distribution) s3:GetObject.
#
# Prints: CLOUDFRONT_DIST_ID, CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID.
#
# Generate the signing keypair first (private key stays local + goes to Secrets Manager
# as buttercupp/CLOUDFRONT_PRIVATE_KEY):
#   openssl genrsa -out cf_private.pem 2048
#   openssl rsa -pubout -in cf_private.pem -out cloudfront_signing_public_key.pem
#
# Usage:
#   ./04-provision-cloudfront.sh            # interactive
#   ./04-provision-cloudfront.sh --yes
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account

CF_REGION="$CLOUDFRONT_ACM_REGION"   # us-east-1
# A custom media domain (media.buttercupp.fun) needs an ISSUED ACM cert, which
# needs DNS validation first. For a fast launch we default to the built-in
# *.cloudfront.net domain (no alias, no cert; already allowed by the app CSP).
# Set CF_CUSTOM_MEDIA_DOMAIN=true (after validating the cert) to use $MEDIA_HOST.
CF_CUSTOM_MEDIA_DOMAIN="${CF_CUSTOM_MEDIA_DOMAIN:-false}"
pubkey_file="$SCRIPT_DIR/cloudfront_signing_public_key.pem"
[ -f "$pubkey_file" ] || die "missing $pubkey_file (generate with openssl, see header comment)"

# CallerReference values must be stable-per-resource so re-runs are idempotent.
oac_name="$PROJECT-oac"
pubkey_name="$PROJECT-signing-key"
keygroup_name="$PROJECT-key-group"

# =============================================================================
# (a) ACM certificate for MEDIA_HOST in us-east-1 (only for the custom domain)
# =============================================================================
cert_arn=""
if [ "$CF_CUSTOM_MEDIA_DOMAIN" = "true" ]; then
  log "Ensuring ACM cert for $MEDIA_HOST in $CF_REGION ..."
  cert_arn="$(aws acm list-certificates --region "$CF_REGION" \
    --query "CertificateSummaryList[?DomainName=='$MEDIA_HOST'].CertificateArn | [0]" \
    --output text 2>/dev/null || true)"
  if [ -z "$cert_arn" ] || [ "$cert_arn" = "None" ]; then
    confirm "Request an ACM cert for $MEDIA_HOST in $CF_REGION (DNS validation)"
    cert_arn="$(aws acm request-certificate --region "$CF_REGION" \
      --domain-name "$MEDIA_HOST" \
      --validation-method DNS \
      --query CertificateArn --output text)"
    ok "Requested cert: $cert_arn"
    sleep 5
  else
    ok "ACM cert already exists: $cert_arn"
  fi
  log "DNS validation record (add this CNAME to your DNS to validate the cert):"
  aws acm describe-certificate --region "$CF_REGION" --certificate-arn "$cert_arn" \
    --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json || true
  cert_status="$(aws acm describe-certificate --region "$CF_REGION" --certificate-arn "$cert_arn" \
    --query 'Certificate.Status' --output text)"
  [ "$cert_status" = "ISSUED" ] || die "cert status=$cert_status; a custom-alias distribution needs an ISSUED cert. Add the CNAME above, wait for ISSUED, then re-run."
else
  log "Using the built-in *.cloudfront.net domain for media (no custom alias/cert)."
  log "  Set CF_CUSTOM_MEDIA_DOMAIN=true later to attach $MEDIA_HOST."
fi

# =============================================================================
# (b) Origin Access Control (OAC)
# =============================================================================
oac_id="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$oac_name'].Id | [0]" --output text 2>/dev/null || true)"
if [ -z "$oac_id" ] || [ "$oac_id" = "None" ]; then
  confirm "Create CloudFront Origin Access Control $oac_name"
  oac_id="$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{
      \"Name\": \"$oac_name\",
      \"Description\": \"ButterCupp S3 OAC\",
      \"SigningProtocol\": \"sigv4\",
      \"SigningBehavior\": \"always\",
      \"OriginAccessControlOriginType\": \"s3\"
    }" \
    --query 'OriginAccessControl.Id' --output text)"
  ok "Created OAC: $oac_id"
else
  ok "OAC already exists: $oac_id"
fi

# =============================================================================
# (d) CloudFront public key + key group (needed before the distribution so the
#     default behavior can reference the trusted key group).
# =============================================================================
pubkey_pem="$(cat "$pubkey_file")"

pubkey_id="$(aws cloudfront list-public-keys \
  --query "PublicKeyList.Items[?Name=='$pubkey_name'].Id | [0]" --output text 2>/dev/null || true)"
if [ -z "$pubkey_id" ] || [ "$pubkey_id" = "None" ]; then
  confirm "Upload CloudFront public key $pubkey_name (for signed URLs)"
  pubkey_id="$(aws cloudfront create-public-key \
    --public-key-config "{
      \"CallerReference\": \"$pubkey_name\",
      \"Name\": \"$pubkey_name\",
      \"EncodedKey\": $(jq -Rs . <<<"$pubkey_pem"),
      \"Comment\": \"ButterCupp CloudFront signing key\"
    }" \
    --query 'PublicKey.Id' --output text)"
  ok "Created public key: $pubkey_id"
else
  ok "Public key already exists: $pubkey_id"
fi

keygroup_id="$(aws cloudfront list-key-groups \
  --query "KeyGroupList.Items[?KeyGroup.KeyGroupConfig.Name=='$keygroup_name'].KeyGroup.Id | [0]" \
  --output text 2>/dev/null || true)"
if [ -z "$keygroup_id" ] || [ "$keygroup_id" = "None" ]; then
  confirm "Create CloudFront key group $keygroup_name (trusts $pubkey_name)"
  keygroup_id="$(aws cloudfront create-key-group \
    --key-group-config "{
      \"Name\": \"$keygroup_name\",
      \"Items\": [\"$pubkey_id\"],
      \"Comment\": \"ButterCupp trusted signer key group\"
    }" \
    --query 'KeyGroup.Id' --output text)"
  ok "Created key group: $keygroup_id"
else
  ok "Key group already exists: $keygroup_id"
fi

# =============================================================================
# (c) CloudFront distribution
# =============================================================================
region_domain() { echo "$1.s3.${AWS_REGION}.amazonaws.com"; }  # regional S3 REST endpoint
origin_default="s3-character-media"
origin_generated="s3-generated"
origin_reels="s3-reels"

# Look for an existing distribution by our unique CallerReference / comment.
dist_caller="$PROJECT-media-dist"
dist_id="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$dist_caller'].Id | [0]" --output text 2>/dev/null || true)"

if [ -n "$dist_id" ] && [ "$dist_id" != "None" ]; then
  ok "CloudFront distribution already exists: $dist_id (skipping create; update via console if config changed)"
  dist_domain="$(aws cloudfront get-distribution --id "$dist_id" \
    --query 'Distribution.DomainName' --output text)"
else
  # Build the distribution config. The default behavior requires the trusted key
  # group (signed URLs). images/* -> generated bucket, reels/* -> reels bucket.
  dist_config="$(jq -n \
    --argjson custom "$([ "$CF_CUSTOM_MEDIA_DOMAIN" = true ] && echo true || echo false)" \
    --arg caller "$dist_caller" \
    --arg alias "$MEDIA_HOST" \
    --arg cert "$cert_arn" \
    --arg oac "$oac_id" \
    --arg kg "$keygroup_id" \
    --arg od "$origin_default"    --arg dd "$(region_domain "$S3_BUCKET")" \
    --arg og "$origin_generated"  --arg dg "$(region_domain "$S3_BUCKET_GENERATED")" \
    --arg or "$origin_reels"      --arg dr "$(region_domain "$S3_BUCKET_REELS")" \
    '{
      CallerReference: $caller,
      Comment: $caller,
      Enabled: true,
      Aliases: (if $custom then { Quantity: 1, Items: [ $alias ] } else { Quantity: 0, Items: [] } end),
      Origins: {
        Quantity: 3,
        Items: [
          { Id: $od, DomainName: $dd, OriginAccessControlId: $oac, S3OriginConfig: { OriginAccessIdentity: "" } },
          { Id: $og, DomainName: $dg, OriginAccessControlId: $oac, S3OriginConfig: { OriginAccessIdentity: "" } },
          { Id: $or, DomainName: $dr, OriginAccessControlId: $oac, S3OriginConfig: { OriginAccessIdentity: "" } }
        ]
      },
      DefaultCacheBehavior: {
        TargetOriginId: $od,
        ViewerProtocolPolicy: "redirect-to-https",
        Compress: true,
        AllowedMethods: { Quantity: 2, Items: ["GET","HEAD"], CachedMethods: { Quantity: 2, Items: ["GET","HEAD"] } },
        TrustedKeyGroups: { Enabled: true, Quantity: 1, Items: [ $kg ] },
        ForwardedValues: { QueryString: false, Cookies: { Forward: "none" }, Headers: { Quantity: 0 }, QueryStringCacheKeys: { Quantity: 0 } },
        MinTTL: 0, DefaultTTL: 86400, MaxTTL: 31536000
      },
      CacheBehaviors: {
        Quantity: 2,
        Items: [
          {
            PathPattern: "images/*",
            TargetOriginId: $og,
            ViewerProtocolPolicy: "redirect-to-https",
            Compress: true,
            AllowedMethods: { Quantity: 2, Items: ["GET","HEAD"], CachedMethods: { Quantity: 2, Items: ["GET","HEAD"] } },
            TrustedKeyGroups: { Enabled: true, Quantity: 1, Items: [ $kg ] },
            ForwardedValues: { QueryString: false, Cookies: { Forward: "none" }, Headers: { Quantity: 0 }, QueryStringCacheKeys: { Quantity: 0 } },
            MinTTL: 0, DefaultTTL: 86400, MaxTTL: 31536000
          },
          {
            PathPattern: "reels/*",
            TargetOriginId: $or,
            ViewerProtocolPolicy: "redirect-to-https",
            Compress: true,
            AllowedMethods: { Quantity: 2, Items: ["GET","HEAD"], CachedMethods: { Quantity: 2, Items: ["GET","HEAD"] } },
            TrustedKeyGroups: { Enabled: true, Quantity: 1, Items: [ $kg ] },
            ForwardedValues: { QueryString: false, Cookies: { Forward: "none" }, Headers: { Quantity: 0 }, QueryStringCacheKeys: { Quantity: 0 } },
            MinTTL: 0, DefaultTTL: 86400, MaxTTL: 31536000
          }
        ]
      },
      ViewerCertificate: (if $custom
        then { ACMCertificateArn: $cert, SSLSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021" }
        else { CloudFrontDefaultCertificate: true } end),
      PriceClass: "PriceClass_100"
    }')"

  confirm "Create CloudFront distribution (alias $MEDIA_HOST, 3 S3 origins, signed-URL key group)"
  dist_json="$(aws cloudfront create-distribution --distribution-config "$dist_config")"
  dist_id="$(jq -r '.Distribution.Id' <<<"$dist_json")"
  dist_domain="$(jq -r '.Distribution.DomainName' <<<"$dist_json")"
  ok "Created distribution: $dist_id"
fi

# =============================================================================
# (e) S3 bucket policies granting the OAC read access, scoped to this distribution
# =============================================================================
dist_arn="arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${dist_id}"
apply_oac_bucket_policy() {  # $1 bucket
  local bucket="$1"
  local policy
  policy="$(jq -n --arg b "$bucket" --arg arn "$dist_arn" \
    '{
      Version: "2012-10-17",
      Statement: [{
        Sid: "AllowCloudFrontOAC",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: ("arn:aws:s3:::" + $b + "/*"),
        Condition: { StringEquals: { "AWS:SourceArn": $arn } }
      }]
    }')"
  confirm "Attach OAC read policy to s3://$bucket (SourceArn=$dist_arn)"
  aws s3api put-bucket-policy --bucket "$bucket" --policy "$policy"
  ok "Bucket policy updated: s3://$bucket"
}
apply_oac_bucket_policy "$S3_BUCKET"
apply_oac_bucket_policy "$S3_BUCKET_GENERATED"
apply_oac_bucket_policy "$S3_BUCKET_REELS"

echo
ok "CloudFront complete. Paste into config.env:"
cat <<EOF
  CLOUDFRONT_DIST_ID=$dist_id
  CLOUDFRONT_DOMAIN=$dist_domain
  CLOUDFRONT_KEY_PAIR_ID=$pubkey_id
EOF
log "Also set Secrets Manager: buttercupp/CLOUDFRONT_URL=https://$dist_domain (or https://$MEDIA_HOST once DNS is live),"
log "  buttercupp/CLOUDFRONT_KEY_PAIR_ID=$pubkey_id, buttercupp/CLOUDFRONT_PRIVATE_KEY=<contents of cf_private.pem>."
log "Point $MEDIA_HOST at $dist_domain with a DNS CNAME/ALIAS to serve over the custom domain."
