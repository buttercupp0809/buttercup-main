#!/usr/bin/env bash
# Upload all local reel mp4s to the S3 reels bucket (POPPY_S3_BUCKET_REELS).
#
# These are the 65 .mp4 files under frontend/public/reels/. After this runs
# they live at s3://$POPPY_S3_BUCKET_REELS/reels/<filename> and are served
# via CloudFront (or the /api/media proxy when CloudFront is not configured).
# After the upload is verified the local files are removed from the repo and
# frontend/lib/reels/manifest.ts points at bare S3 keys (reels/<id>.mp4).
#
# Usage:
#   AWS_REGION=eu-north-1 POPPY_S3_BUCKET_REELS=poppy-reels \
#     bash Plans/inference-aws/upload-reels-to-s3.sh
#
# Or source backend/.env first to pick up both env vars automatically:
#   source backend/.env && bash Plans/inference-aws/upload-reels-to-s3.sh
#
# Dry run (prints the plan without uploading):
#   DRY_RUN=1 bash Plans/inference-aws/upload-reels-to-s3.sh
#
# Requires: aws CLI authenticated (aws configure or env key/secret).

set -euo pipefail

BUCKET="${POPPY_S3_BUCKET_REELS:-}"
if [[ -z "$BUCKET" ]]; then
  echo "ERROR: POPPY_S3_BUCKET_REELS is not set. Set it before running this script."
  echo "  Example: POPPY_S3_BUCKET_REELS=poppy-reels bash upload-reels-to-s3.sh"
  exit 1
fi

REGION="${AWS_REGION:-}"
if [[ -z "$REGION" ]]; then
  echo "ERROR: AWS_REGION is not set. Set it before running this script."
  echo "  Example: AWS_REGION=eu-north-1 bash upload-reels-to-s3.sh"
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REELS_DIR="$HERE/../../frontend/public/reels"

if [[ ! -d "$REELS_DIR" ]]; then
  echo "ERROR: reels directory not found at $REELS_DIR"
  exit 1
fi

FILE_COUNT=$(find "$REELS_DIR" -type f -name "*.mp4" | wc -l | tr -d ' ')
echo "==> Uploading $FILE_COUNT reel mp4s to s3://$BUCKET/reels/ (region: $REGION)"

DRYRUN_FLAG=""
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  DRYRUN_FLAG="--dryrun"
  echo "==> DRY_RUN=1: aws s3 sync will run with --dryrun (no bytes uploaded)"
fi

aws s3 sync "$REELS_DIR" "s3://$BUCKET/reels/" \
  --region "$REGION" \
  --exclude "*.DS_Store" \
  --content-type "video/mp4" \
  --cache-control "public, max-age=31536000, immutable" \
  $DRYRUN_FLAG

echo "==> Done. Reels are at s3://$BUCKET/reels/<filename>"
echo "    Manifest keys: frontend/lib/reels/manifest.ts src = reels/<id>.mp4"
