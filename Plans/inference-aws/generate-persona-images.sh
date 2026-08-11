#!/usr/bin/env bash
# ============================================================
# generate-persona-images.sh
#
# Flow: take a persona's MAIN image -> wake the Juggernaut (ComfyUI) GPU box
# -> generate one variant image per prompt, one by one in a loop
# -> save each variant with a manifest.json that references the main
#    image (the "foreign key" linking generated images to the persona).
#
# Usage:
#   ./generate-persona-images.sh <persona_id> <main_image_path> [out_dir]
#
# Example:
#   ./generate-persona-images.sh poppy01 ~/Desktop/poppy-main.png
#
# Optional S3+DB env vars (export before running to persist to S3/DB):
#   CHARACTER_ID=<prisma character id>
#   POPPY_API_TOKEN=<backend JWT for API calls>
#   API_BASE_URL=http://localhost:4000
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need aws; need curl; need python3
require_state

PERSONA_ID="${1:-}"; MAIN_IMAGE="${2:-}"; OUT_DIR="${3:-$HERE/persona-output}"
[[ -z "$PERSONA_ID" || -z "$MAIN_IMAGE" ]] && die "usage: $0 <persona_id> <main_image_path> [out_dir]"
[[ -f "$MAIN_IMAGE" ]] || die "main image not found: $MAIN_IMAGE"

# Prompts come from persona-prompts.txt (one per line). Edit them there.
PROMPTS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  PROMPTS+=("$line")
done < "$HERE/persona-prompts.txt"
[[ ${#PROMPTS[@]} -eq 0 ]] && die "no prompts in persona-prompts.txt"

# ---- generation params (InstantID + Juggernaut XL v9) ---------
CKPT="${POPPY_JUGGERNAUT_CHECKPOINT:-$JUGGERNAUT_MODEL_NAME}"
IP_WEIGHT="1.05"        # InstantID identity (ArcFace) strength.
CN_STRENGTH="0.0"       # 0 = no ControlNet keypoint pose lock; head direction
                        # comes from POSE_PREFIXES in persona_pipeline.py.
END_AT="0.75"           # still passed to the node (unused when cn_strength=0).
STEPS="30"; CFG="4.5"; SAMPLER="dpmpp_2m"; SCHED="karras"
# NOTE: framing terms (full body / margins) are KEPT from the 9:16 change; the
# lighting terms were reverted to the earlier, higher-quality wording.
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

# ---- 1. Wake the box via the router, get its IP ------------
ROUTER_URL="$(state_get ROUTER_URL)"
[[ -z "$ROUTER_URL" ]] && die "no ROUTER_URL in state (deploy the router first: ./60-router-deploy.sh)"
TOK="$ROUTER_AUTH_TOKEN"
log "Waking GPU via router"
curl -s --max-time 30 "$ROUTER_URL/wake?token=$TOK" >/dev/null 2>&1
IP=""
for i in $(seq 1 60); do
  resp=$(curl -s --max-time 10 "$ROUTER_URL/status?token=$TOK" 2>/dev/null)
  IP=$(echo "$resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('ip') or '')" 2>/dev/null)
  ready=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ready'))" 2>/dev/null)
  [[ "$ready" == "True" && -n "$IP" ]] && { ok "box running at $IP"; break; }
  echo "  waking... (${i})"; sleep 10
done
[[ -z "$IP" ]] && die "box did not become ready"

# ---- 2. Make sure your IP can reach the box ---------------
MYIP="$(my_ip)/32"; SG_ID="$(state_get SG_ID)"
for p in 22 8001 8188; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=owner}]" 2>/dev/null || true
done

# ---- 3. Wait for ComfyUI to answer -------------------------
log "Waiting for ComfyUI on $IP:8188"
for i in $(seq 1 60); do
  curl -fsS --max-time 5 "http://$IP:8188/system_stats" >/dev/null 2>&1 && { ok "ComfyUI up"; break; }
  sleep 10; [[ $i -eq 60 ]] && die "ComfyUI never came up"
done

# ---- 4. Upload the persona main image to ComfyUI ----------
log "Uploading main image: $MAIN_IMAGE"
UP=$(curl -s --max-time 60 -F "image=@$MAIN_IMAGE" -F "overwrite=true" "http://$IP:8188/upload/image")
IMG_NAME=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])" 2>/dev/null)
[[ -z "$IMG_NAME" ]] && die "upload failed: $UP"
ok "uploaded as $IMG_NAME"

# ---- 5. Generate one variant per prompt, in a loop --------
"${HERE}/.venv/bin/python3" "$HERE/persona_pipeline.py" \
  "$IP" "$PERSONA_ID" "$MAIN_IMAGE" "$OUT_DIR" "$IMG_NAME" \
  "$CKPT" "$IP_WEIGHT" "$CN_STRENGTH" "$END_AT" "$STEPS" "$CFG" "$SAMPLER" "$SCHED" "$NEG" "$QUALITY" \
  "${PROMPTS[@]}"

echo
ok "Output: $OUT_DIR/$PERSONA_ID/ (variant-N.png + manifest.json)"
warn "Box is still running. It idle-stops itself after ${IDLE_MINUTES}m, or run ./30-stop.sh now."
