#!/usr/bin/env bash
# download-generated-images.sh
# Download images from the poppy-generated S3 bucket by position range.
#
# Usage examples:
#   ./download-generated-images.sh 100          # first 100 images (1-100)
#   ./download-generated-images.sh 1 100        # images 1 to 100
#   ./download-generated-images.sh 101 200      # images 101 to 200
#   ./download-generated-images.sh 501 600      # images 501 to 600
#
# Images land in ./downloaded-images/  (relative to where you run the script).
# Only .webp files are downloaded by default (smaller). Pass --png to get .png.
set -euo pipefail

BUCKET="poppy-generated"
PREFIX="images/"
REGION="eu-north-1"
OUTDIR="downloaded-images"

# ---- Argument parsing -------------------------------------------------------
PNG_ONLY=false
ARGS=()
for a in "$@"; do
  case "$a" in
    --png) PNG_ONLY=true ;;
    *)     ARGS+=("$a") ;;
  esac
done

if [ "${#ARGS[@]}" -eq 0 ]; then
  echo "Usage: $0 <count>              # first N images"
  echo "       $0 <start> <end>        # images start to end (1-based)"
  echo "       $0 <start> <end> --png  # download .png instead of .webp"
  exit 1
elif [ "${#ARGS[@]}" -eq 1 ]; then
  START=1
  END="${ARGS[0]}"
else
  START="${ARGS[0]}"
  END="${ARGS[1]}"
fi

if ! [[ "$START" =~ ^[0-9]+$ ]] || ! [[ "$END" =~ ^[0-9]+$ ]]; then
  echo "Error: start and end must be integers." >&2; exit 1
fi
if [ "$START" -lt 1 ]; then
  echo "Error: start must be >= 1." >&2; exit 1
fi
if [ "$START" -gt "$END" ]; then
  echo "Error: start ($START) must be <= end ($END)." >&2; exit 1
fi

COUNT=$(( END - START + 1 ))

# ---- Determine file extension -----------------------------------------------
if [ "$PNG_ONLY" = true ]; then
  EXT=".png"
else
  EXT=".webp"
fi

echo "==> Listing ${BUCKET}/${PREFIX} ..."
ALL_KEYS="$(aws s3 ls "s3://${BUCKET}/${PREFIX}" --recursive --region "$REGION" \
  | awk '{print $4}' \
  | grep "${EXT}$" \
  | sort)"

TOTAL=$(echo "$ALL_KEYS" | wc -l | tr -d ' ')
echo "    Found $TOTAL ${EXT} objects total."

if [ "$START" -gt "$TOTAL" ]; then
  echo "Error: start ($START) exceeds total object count ($TOTAL)." >&2; exit 1
fi

# Clamp end to total
if [ "$END" -gt "$TOTAL" ]; then
  echo "    Warning: end ($END) > total ($TOTAL), clamping to $TOTAL."
  END="$TOTAL"
  COUNT=$(( END - START + 1 ))
fi

SELECTED=$(echo "$ALL_KEYS" | sed -n "${START},${END}p")

mkdir -p "$OUTDIR"
echo "==> Downloading images ${START}-${END} ($COUNT files) -> ${OUTDIR}/"
echo

DONE=0
FAILED=0
while IFS= read -r key; do
  filename="$(basename "$key")"
  dest="${OUTDIR}/${filename}"
  if [ -f "$dest" ]; then
    printf "  [skip] %s (already exists)\n" "$filename"
    DONE=$(( DONE + 1 ))
    continue
  fi
  if aws s3 cp "s3://${BUCKET}/${key}" "$dest" --region "$REGION" --quiet; then
    DONE=$(( DONE + 1 ))
    printf "  [%d/%d] %s\n" "$DONE" "$COUNT" "$filename"
  else
    FAILED=$(( FAILED + 1 ))
    printf "  [FAIL] %s\n" "$filename" >&2
  fi
done <<< "$SELECTED"

echo
echo "Done. Downloaded: $DONE  Failed: $FAILED"
echo "Files are in: $(pwd)/${OUTDIR}/"
