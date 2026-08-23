#!/usr/bin/env bash
# poppy-video provisioning (cloud-init). Runs ONCE on first boot. Installs Wan
# 2.2 A14B (fp8) into ComfyUI (ai-dock image) on :8188 as a systemd service.
# Writes /opt/poppy/READY when models are down and ComfyUI answers, so the
# controller can poll readiness.
set -uxo pipefail
exec > >(tee -a /var/log/poppy-video-userdata.log) 2>&1
echo "=== poppy-video provisioning $(date -u) ==="

ROOT=/opt/poppy
MODELS=$ROOT/models/comfyui
CUSTOM_NODES=$ROOT/comfyui-custom-nodes
mkdir -p "$MODELS/diffusion_models" "$MODELS/text_encoders" "$MODELS/vae" "$MODELS/loras" "$ROOT/comfyui-data" "$CUSTOM_NODES"
chmod -R 777 "$ROOT"

# Swap: fp8 model load spikes host RAM during safetensors mmap.
if [ ! -f /swapfile ]; then
  fallocate -l 24G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
fi

dl () { # url dest
  local url="$1" dest="$2"
  [ -s "$dest" ] && { echo "exists: $dest"; return 0; }
  echo ">> $url"
  curl -fL --retry 5 --retry-delay 5 -o "$dest" "$url" || echo "!! download failed: $url"
}

HF="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"
# I2V experts (fp8) - the "bring the character alive" path.
dl "$HF/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" "$MODELS/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
dl "$HF/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"  "$MODELS/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
# T2V experts (fp8) - optional, enables text-to-video too.
dl "$HF/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors" "$MODELS/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"
dl "$HF/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"  "$MODELS/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"
# Shared text encoder + VAE.
dl "$HF/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" "$MODELS/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
dl "$HF/vae/wan_2.1_vae.safetensors" "$MODELS/vae/wan_2.1_vae.safetensors"
chmod -R 777 "$MODELS"

# RIFE frame-interpolation custom node (ComfyUI-Frame-Interpolation by Fannovel16).
# Cloned into the host custom_nodes directory, which is volume-mounted into the
# container at /opt/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation. Idempotent:
# skips clone if the directory already exists (e.g. on a re-provision or reboot
# where EBS retained the data). The rife49.pth checkpoint auto-downloads on the
# first RIFE render; no manual fetch needed here.
RIFE_DIR="$CUSTOM_NODES/ComfyUI-Frame-Interpolation"
if [ ! -d "$RIFE_DIR/.git" ]; then
  git clone --depth 1 https://github.com/Fannovel16/ComfyUI-Frame-Interpolation "$RIFE_DIR"
else
  echo "exists: $RIFE_DIR (skip clone)"
fi

# ComfyUI systemd service (ai-dock image, GPU, models mounted).
# NOTE: quoted heredoc + single-line ExecStart. An earlier version used an
# unquoted heredoc with backslash line-continuations and wrote a 0-byte file,
# which systemd treats as MASKED (service never starts). Keep this literal.
cat >/etc/systemd/system/poppy-wan.service <<'UNIT'
[Unit]
Description=poppy Wan 2.2 (ComfyUI) :8188
After=docker.service
Requires=docker.service
[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f poppy-wan
ExecStart=/usr/bin/docker run --rm --name poppy-wan --gpus all -e WEB_ENABLE_AUTH=false -p 8188:8188 -v /opt/poppy/models/comfyui/diffusion_models:/opt/ComfyUI/models/diffusion_models -v /opt/poppy/models/comfyui/text_encoders:/opt/ComfyUI/models/text_encoders -v /opt/poppy/models/comfyui/vae:/opt/ComfyUI/models/vae -v /opt/poppy/models/comfyui/loras:/opt/ComfyUI/models/loras -v /opt/poppy/comfyui-data:/opt/ComfyUI/output -v /opt/poppy/comfyui-custom-nodes:/opt/ComfyUI/custom_nodes aidockorg/comfyui-cuda:latest
ExecStop=/usr/bin/docker stop poppy-wan
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-wan.service || echo "!! unit file is empty"

systemctl daemon-reload
systemctl enable --now poppy-wan.service

# Wait for ComfyUI to answer, then drop a READY marker.
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "comfyui up"; break
  fi
  sleep 10
done

# Install RIFE pip requirements inside the container now that it is running.
# The node directory is already present via the volume mount. pip install is
# idempotent: re-running on a reprovisioned box with cached packages is fast.
RIFE_REQ="/opt/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation/requirements.txt"
docker exec poppy-wan bash -c "
  PYTHON=\$(command -v python3 || command -v python) &&
  if [ -f '$RIFE_REQ' ]; then
    \$PYTHON -m pip install --quiet --no-warn-script-location -r '$RIFE_REQ'
    echo 'rife pip install done'
  else
    echo 'rife requirements.txt not found; skipping pip (node may have been empty)'
  fi
" || echo "!! rife pip install failed (non-fatal; check manually)"

# NOTE: after the box is running with the RIFE node installed, set
#   WAN_INTERPOLATION=1
# in the backend environment to enable Stage C (32fps interpolation).
# Do NOT set that env var automatically; it requires human sign-off.

echo "READY $(date -u)" > "$ROOT/READY"
echo "=== provisioning done $(date -u) ==="
