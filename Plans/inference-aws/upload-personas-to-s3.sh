#!/usr/bin/env bash
# Upload all local persona stock images to the S3 media bucket (copyMediaBucket).
#
# These are the 130+ .webp/.png files under frontend/public/personas/.
# After this runs they live at s3://$S3_BUCKET/personas/<filename> and will be
# served via CloudFront. The local files are kept on disk but are no longer
# referenced by the UI (persona-images.ts returns null for all seeds).
#
# Usage:
#   AWS_REGION=eu-north-1 S3_BUCKET=poppy-uploads-<account> bash upload-personas-to-s3.sh
#
# Or source backend/.env first to pick up S3_BUCKET automatically:
#   source ../../backend/.env && bash upload-personas-to-s3.sh
#
# Requires: aws CLI authenticated (aws configure or env key/secret).

set -euo pipefail

BUCKET="${S3_BUCKET:-}"
if [[ -z "$BUCKET" ]]; then
  echo "ERROR: S3_BUCKET is not set. Set it before running this script."
  echo "  Example: S3_BUCKET=poppy-uploads-123456789012 bash upload-personas-to-s3.sh"
  exit 1
fi

REGION="${AWS_REGION:-eu-north-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERSONAS_DIR="$HERE/../../frontend/public/personas"

if [[ ! -d "$PERSONAS_DIR" ]]; then
  echo "ERROR: personas directory not found at $PERSONAS_DIR"
  exit 1
fi

FILE_COUNT=$(find "$PERSONAS_DIR" -type f \( -name "*.webp" -o -name "*.png" -o -name "*.jpg" \) | wc -l | tr -d ' ')
echo "==> Uploading $FILE_COUNT persona images to s3://$BUCKET/personas/ (region: $REGION)"

aws s3 sync "$PERSONAS_DIR" "s3://$BUCKET/personas/" \
  --region "$REGION" \
  --exclude "*.DS_Store" \
  --content-type "image/webp" \
  --cache-control "public, max-age=31536000, immutable" \
  --no-progress

echo "==> Done. Images are at s3://$BUCKET/personas/<filename>"
echo "    CloudFront URL pattern: \$CLOUDFRONT_URL/personas/<filename>"
echo ""
echo "Next steps:"
echo "  1. Make sure CloudFront distribution has /personas/* in its behavior."
echo "  2. Update character records in the DB: set media.url = 'personas/<filename>'"
echo "     so the signAssetUrl() function serves them via CloudFront."
