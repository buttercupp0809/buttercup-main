#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/.state" ]] || { echo "no .state file -- nothing to destroy"; exit 1; }
source "$HERE/.state"
echo "This will DELETE all 3 S3 buckets and the CloudFront distribution."
read -r -p "Type DESTROY to confirm: " CONFIRM
[[ "$CONFIRM" == "DESTROY" ]] || { echo "aborted"; exit 1; }
# Disable + delete CloudFront distribution
ETAG=$(aws cloudfront get-distribution --id "$CF_DIST_ID" --query 'ETag' --output text)
aws cloudfront get-distribution-config --id "$CF_DIST_ID" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); d['DistributionConfig']['Enabled']=False; print(json.dumps(d['DistributionConfig']))" \
  > /tmp/cf-disable.json
aws cloudfront update-distribution --id "$CF_DIST_ID" \
  --distribution-config file:///tmp/cf-disable.json --if-match "$ETAG" >/dev/null
echo "Disabled CF dist $CF_DIST_ID -- wait ~5 min then re-run to delete buckets."
# Empty and delete buckets
for B in "$B_UPL" "$B_GEN" "$B_VID"; do
  aws s3 rm "s3://$B" --recursive 2>/dev/null || true
  aws s3api delete-bucket --bucket "$B" --region "$AWS_REGION" 2>/dev/null || true
  echo "deleted $B"
done
echo "Destroy complete. Delete the CF distribution manually once Deployed -> Disabled."
