#!/usr/bin/env bash
# ============================================================
# generate-persona-images-batch.sh
#
# BATCH flow: sweep a folder of persona MAIN images and, for EACH one,
# generate a variant per prompt (from persona-prompts.txt). 100 images
# with 4 prompts -> 400 generated images. Each persona's variants are
# saved with a manifest.json referencing that persona's main image.
#
# The GPU box is woken ONCE and reused for the whole run (efficient).
#
# Usage:
#   ./generate-persona-images-batch.sh <input_dir> [out_dir]
#
# Example:
#   ./generate-persona-images-batch.sh ~/personas ./persona-output
#
# <input_dir> = a folder of persona main images (png/jpg/jpeg/webp).
# persona_id is derived from each file name (without extension).
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need aws; need curl; need python3
require_state

INPUT_DIR="${1:-}"; OUT_DIR="${2:-$HERE/persona-output}"
[[ -z "$INPUT_DIR" ]] && die "usage: $0 <input_dir> [out_dir]"
[[ -d "$INPUT_DIR" ]] || die "input dir not found: $INPUT_DIR"

# ---- collect persona images -------------------------------
IMAGES=()
while IFS= read -r f; do IMAGES+=("$f"); done < <(find "$INPUT_DIR" -maxdepth 1 -type f \
  \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) | sort)
[[ ${#IMAGES[@]} -eq 0 ]] && die "no images (png/jpg/jpeg/webp) in $INPUT_DIR"

# ---- prompts (shared file) --------------------------------
PROMPTS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  PROMPTS+=("$line")
done < "$HERE/persona-prompts.txt"
[[ ${#PROMPTS[@]} -eq 0 ]] && die "no prompts in persona-prompts.txt"

TOTAL=$(( ${#IMAGES[@]} * ${#PROMPTS[@]} ))
log "Personas: ${#IMAGES[@]}  x  prompts: ${#PROMPTS[@]}  =  $TOTAL images to generate"

# ---- generation params (same as single) -------------------
CKPT="${POPPY_JUGGERNAUT_CHECKPOINT:-$JUGGERNAUT_MODEL_NAME}"
IP_WEIGHT="1.05"; CN_STRENGTH="0.0"; END_AT="0.75"
STEPS="30"; CFG="4.5"; SAMPLER="dpmpp_2m"; SCHED="karras"
# Framing terms (full body / margins) KEPT; lighting terms reverted to the
# earlier, higher-quality wording.
QUALITY="full body from head to toe, entire figure visible including feet, full length wide shot, whole body inside the frame, subject centered with empty space and margin above the head and below the feet, standing far from camera, RAW photo, photorealistic, soft even lighting, bright natural light, well-lit, masterpiece, best quality, 8k uhd, dslr, sharp focus, high detail, "
SAFETY="child, kid, minor, underage, teen"
NEG="cropped, out of frame, head out of frame, hands cut off, cut off, close-up, zoomed in, partial body, dark, low-key lighting, harsh shadows, underexposed, deep shadows, high contrast, deformed iris, deformed pupils, cartoon, anime, illustration, 3d render, cgi, sketch, drawing, bad anatomy, bad hands, extra fingers, mutated hands, poorly drawn face, mutation, deformed, blurry, watermark, text, jpeg artifacts, ugly, duplicate, $SAFETY"

# S3 + DB integration (optional -- set these env vars before running to persist to S3/DB)
export POPPY_S3_BUCKET_GENERATED="${POPPY_S3_BUCKET_GENERATED:-}"
export AWS_REGION="${AWS_REGION:-eu-north-1}"
export CLOUDFRONT_URL="${CLOUDFRONT_URL:-}"
export POPPY_CHARACTER_ID="${CHARACTER_ID:-}"
export POPPY_API_BASE_URL="${API_BASE_URL:-http://localhost:4000}"
export POPPY_API_TOKEN="${POPPY_API_TOKEN:-}"

# ---- 1. Wake the box ONCE ---------------------------------
ROUTER_URL="$(state_get ROUTER_URL)"
[[ -z "$ROUTER_URL" ]] && die "no ROUTER_URL in state (run ./60-router-deploy.sh first)"
TOK="$ROUTER_AUTH_TOKEN"
log "Waking GPU via router"
curl -s --max-time 30 "$ROUTER_URL/wake?token=$TOK" >/dev/null 2>&1
IP=""
for i in $(seq 1 60); do
  resp=$(curl -s --max-time 10 "$ROUTER_URL/status?token=$TOK" 2>/dev/null)
  IP=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ip') or '')" 2>/dev/null)
  ready=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ready'))" 2>/dev/null)
  [[ "$ready" == "True" && -n "$IP" ]] && { ok "box running at $IP"; break; }
  echo "  waking... ($i)"; sleep 10
done
[[ -z "$IP" ]] && die "box did not become ready"

# ---- 2. SG + ComfyUI health (once) ------------------------
MYIP="$(my_ip)/32"; SG_ID="$(state_get SG_ID)"
for p in 22 8001 8188; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=owner}]" 2>/dev/null || true
done
log "Waiting for ComfyUI on $IP:8188"
for i in $(seq 1 60); do
  curl -fsS --max-time 5 "http://$IP:8188/system_stats" >/dev/null 2>&1 && { ok "ComfyUI up"; break; }
  sleep 10; [[ $i -eq 60 ]] && die "ComfyUI never came up"
done

# ---- 3. Loop every persona image --------------------------
n=0
for MAIN_IMAGE in "${IMAGES[@]}"; do
  n=$((n+1))
  base="$(basename "$MAIN_IMAGE")"
  PERSONA_ID="$(echo "${base%.*}" | tr ' ' '_' | tr -cd '[:alnum:]_-')"
  echo ""
  log "[$n/${#IMAGES[@]}] persona '$PERSONA_ID'  <-  $base"
  UP=$(curl -s --max-time 60 -F "image=@$MAIN_IMAGE" -F "overwrite=true" "http://$IP:8188/upload/image")
  IMG_NAME=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])" 2>/dev/null)
  [[ -z "$IMG_NAME" ]] && { err "upload failed for $base, skipping"; continue; }
  python3 "$HERE/persona_pipeline.py" \
    "$IP" "$PERSONA_ID" "$MAIN_IMAGE" "$OUT_DIR" "$IMG_NAME" \
    "$CKPT" "$IP_WEIGHT" "$CN_STRENGTH" "$END_AT" "$STEPS" "$CFG" "$SAMPLER" "$SCHED" "$NEG" "$QUALITY" \
    "${PROMPTS[@]}"
done

echo ""
ok "Batch done: ${#IMAGES[@]} personas processed. Output under $OUT_DIR/<persona_id>/"
warn "Box is still running. It idle-stops after ${IDLE_MINUTES}m, or run ./30-stop.sh now."
