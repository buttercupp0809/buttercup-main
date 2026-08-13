#!/usr/bin/env bash
# Plans/s3-cdn/10-setup.sh
# Provisions: 3 S3 buckets, 3 OACs, 1 CloudFront distribution, IAM user,
# RSA 2048 key pair for CloudFront signed URLs.
# Run once per environment. Prints env vars to stdout on completion.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AWS_REGION="${AWS_REGION:-eu-north-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
B_UPL="poppy-uploads-$ACCOUNT"
B_GEN="poppy-generated-$ACCOUNT"
B_VID="poppy-videos-$ACCOUNT"

echo "==> Creating S3 buckets in $AWS_REGION"
for B in "$B_UPL" "$B_GEN" "$B_VID"; do
  aws s3api head-bucket --bucket "$B" 2>/dev/null && echo "  $B already exists" && continue
  aws s3api create-bucket --bucket "$B" --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$B" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  echo "  created $B"
done

echo "==> Generating RSA 2048 key pair"
KEY_DIR="$HERE/.keys"; mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
if [[ ! -f "$KEY_DIR/private.pem" ]]; then
  openssl genrsa -out "$KEY_DIR/private.pem" 2048 2>/dev/null
  openssl rsa -pubout -in "$KEY_DIR/private.pem" -out "$KEY_DIR/public.pem" 2>/dev/null
  chmod 600 "$KEY_DIR/private.pem"
fi

echo "==> Uploading public key to CloudFront"
PK_TMP=$(mktemp)
python3 -c "
import json, sys
print(json.dumps({
  'CallerReference': 'poppy-$(date +%s)',
  'Name': 'poppy-sign-key',
  'EncodedKey': open('$KEY_DIR/public.pem').read(),
  'Comment': 'Poppy CDN signing key'
}))
" > "$PK_TMP"
CF_PK_ID=$(aws cloudfront create-public-key \
  --public-key-config "file://$PK_TMP" \
  --query 'PublicKey.Id' --output text)
rm "$PK_TMP"
echo "  key ID: $CF_PK_ID"

echo "==> Creating CloudFront key group"
CF_KG_ID=$(aws cloudfront create-key-group \
  --key-group-config "{\"Name\":\"poppy-keys\",\"Items\":[\"$CF_PK_ID\"],\"Comment\":\"\"}" \
  --query 'KeyGroup.Id' --output text)

echo "==> Creating Origin Access Controls"
create_oac() {
  aws cloudfront create-origin-access-control \
    --origin-access-control-config \
    "{\"Name\":\"$1\",\"Description\":\"\",\"SigningProtocol\":\"sigv4\",\"SigningBehavior\":\"always\",\"OriginAccessControlOriginType\":\"s3\"}" \
    --query 'OriginAccessControl.Id' --output text
}
OAC_UPL=$(create_oac "poppy-oac-uploads")
OAC_GEN=$(create_oac "poppy-oac-generated")
OAC_VID=$(create_oac "poppy-oac-videos")

echo "==> Creating CloudFront distribution (3 origins)"
DIST_TMP=$(mktemp)
python3 - <<PYEOF > "$DIST_TMP"
import json
config = {
  "CallerReference": "poppy-dist-$(date +%s)",
  "Comment": "Poppy CDN",
  "Enabled": True,
  "HttpVersion": "http2",
  "Origins": {
    "Quantity": 3,
    "Items": [
      {
        "Id": "uploads",
        "DomainName": "${B_UPL}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_UPL}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      },
      {
        "Id": "generated",
        "DomainName": "${B_GEN}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_GEN}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      },
      {
        "Id": "videos",
        "DomainName": "${B_VID}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_VID}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "generated",
    "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
  },
  "CacheBehaviors": {
    "Quantity": 2,
    "Items": [
      {
        "PathPattern": "/uploads/*",
        "TargetOriginId": "uploads",
        "ViewerProtocolPolicy": "redirect-to-https",
        "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
      },
      {
        "PathPattern": "/videos/*",
        "TargetOriginId": "videos",
        "ViewerProtocolPolicy": "redirect-to-https",
        "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
      }
    ]
  }
}
print(json.dumps(config))
PYEOF
DIST_OUT=$(aws cloudfront create-distribution \
  --distribution-config "file://$DIST_TMP" \
  --query 'Distribution.{Id:Id,Domain:DomainName}' --output json)
rm "$DIST_TMP"
CF_DIST_ID=$(echo "$DIST_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['Id'])")
CF_DOMAIN=$(echo "$DIST_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['Domain'])")

# Bucket policies for OAC access
attach_bucket_policy() {
  local bucket=$1 dist_id=$2
  aws s3api put-bucket-policy --bucket "$bucket" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"AllowCFOAC\",
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${bucket}/*\",
      \"Condition\": {\"StringEquals\": {\"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT}:distribution/${dist_id}\"}}
    }]
  }"
}
attach_bucket_policy "$B_UPL" "$CF_DIST_ID"
attach_bucket_policy "$B_GEN" "$CF_DIST_ID"
attach_bucket_policy "$B_VID" "$CF_DIST_ID"

echo "==> Creating IAM user poppy-backend"
aws iam create-user --user-name poppy-backend 2>/dev/null || true
aws iam put-user-policy --user-name poppy-backend --policy-name poppy-s3 \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:PutObject\",\"s3:GetObject\",\"s3:DeleteObject\"],
      \"Resource\": [
        \"arn:aws:s3:::${B_UPL}/*\",
        \"arn:aws:s3:::${B_GEN}/*\",
        \"arn:aws:s3:::${B_VID}/*\"
      ]
    }]
  }"
KEY_OUT=$(aws iam create-access-key --user-name poppy-backend \
  --query 'AccessKey.{K:AccessKeyId,S:SecretAccessKey}' --output json)
ACCESS_KEY=$(echo "$KEY_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['K'])")
SECRET_KEY=$(echo "$KEY_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['S'])")

# Save state
cat > "$HERE/.state" <<STATE
CF_DIST_ID=$CF_DIST_ID
CF_PK_ID=$CF_PK_ID
CF_KG_ID=$CF_KG_ID
OAC_UPL=$OAC_UPL
OAC_GEN=$OAC_GEN
OAC_VID=$OAC_VID
B_UPL=$B_UPL
B_GEN=$B_GEN
B_VID=$B_VID
AWS_REGION=$AWS_REGION
ACCOUNT=$ACCOUNT
STATE

PRIV_KEY_ONELINER=$(awk 'NF{printf "%s\\n",$0}' "$KEY_DIR/private.pem")

echo ""
echo "============================================================"
echo "Add these to backend/.env and Plans/s3-cdn/.env:"
echo "============================================================"
echo "AWS_REGION=$AWS_REGION"
echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY"
echo "AWS_SECRET_ACCESS_KEY=$SECRET_KEY"
echo "POPPY_S3_BUCKET_UPLOADS=$B_UPL"
echo "POPPY_S3_BUCKET_GENERATED=$B_GEN"
echo "POPPY_S3_BUCKET_VIDEOS=$B_VID"
echo "S3_BUCKET=$B_GEN"
echo "CLOUDFRONT_URL=https://$CF_DOMAIN"
echo "CLOUDFRONT_KEY_PAIR_ID=$CF_PK_ID"
echo "CLOUDFRONT_PRIVATE_KEY=\"$PRIV_KEY_ONELINER\""
echo "============================================================"
echo "NOTE: CloudFront distribution deploys in 10-15 minutes."
echo "      Check status: aws cloudfront get-distribution --id $CF_DIST_ID --query 'Distribution.Status'"
