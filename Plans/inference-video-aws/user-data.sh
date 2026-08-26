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

# --- Pin ComfyUI to a Wan-2.2-capable tag on EVERY boot ---------------------
# The aidockorg/comfyui-cuda:latest image ships an OLD ComfyUI (v0.2.2, Sept
# 2024) that lacks the Wan 2.2 core nodes (WanImageToVideo,
# Wan22ImageToVideoLatent, SaveWEBM). Because poppy-wan.service runs
# `docker run --rm`, /opt/ComfyUI lives in the container's writable layer and is
# recreated from that old image on every start, silently reverting any upgrade.
# This installs a systemd oneshot that re-applies the pin after the container
# comes up, so a stop/start (which also changes the public IP) never loses the
# Wan nodes. torch is deliberately NOT reinstalled: the image ships a
# CUDA-matched torch 2.4.1 and ComfyUI master needs torch >= 2.5, so we pin the
# newest v0.3.x tag (has Wan 2.2 + SaveWEBM, still runs on torch 2.4).
WAN_COMFY_TAG="v0.3.77"
cat >/opt/poppy/pin-comfyui.sh <<PINEOF
#!/usr/bin/env bash
set -uxo pipefail
TAG="$WAN_COMFY_TAG"
VENV_PY=/opt/environments/python/comfyui/bin/python
# Wait for the container to be running.
for i in \$(seq 1 60); do
  [ "\$(docker inspect -f '{{.State.Running}}' poppy-wan 2>/dev/null)" = "true" ] && break
  sleep 5
done
# Pin ComfyUI to the Wan-capable tag (skip the reinstall if already pinned).
cur="\$(docker exec poppy-wan bash -lc 'git -C /opt/ComfyUI describe --tags 2>/dev/null' || true)"
if [ "\$cur" != "\$TAG" ]; then
  docker exec poppy-wan supervisorctl stop comfyui || true
  docker exec poppy-wan bash -lc "cd /opt/ComfyUI && git fetch --depth 1 origin tag \$TAG && git checkout -f \$TAG"
  docker exec poppy-wan bash -lc "cd /opt/ComfyUI && grep -vE '^(torch|torchvision|torchaudio|torchsde)' requirements.txt > /tmp/comfy-req.txt && \$VENV_PY -m pip install -q -r /tmp/comfy-req.txt"
  docker exec poppy-wan supervisorctl start comfyui
else
  echo "comfyui already at \$TAG"
fi
# RIFE frame-interpolation node. custom_nodes is NOT a mounted volume, so a
# container recreate wipes it - re-add on every boot (idempotent). numpy
# conflict warnings from its requirements are harmless. Enable via
# WAN_INTERPOLATION=1 in the backend env.
RIFE_D=/opt/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation
if ! docker exec poppy-wan test -d "\$RIFE_D/.git"; then
  docker exec poppy-wan git clone --depth 1 https://github.com/Fannovel16/ComfyUI-Frame-Interpolation "\$RIFE_D" || true
  docker exec poppy-wan bash -lc "R=\$RIFE_D/requirements-no-cupy.txt; [ -f \$RIFE_D/requirements.txt ] && R=\$RIFE_D/requirements.txt; \$VENV_PY -m pip install -q --no-warn-script-location -r \\\$R" || true
  # Clone runs as root but ComfyUI runs as 'user'; without this it cannot create
  # ckpts/ to download rife49.pth and every RIFE render fails with PermissionError.
  docker exec poppy-wan chmod -R 777 "\$RIFE_D" || true
  docker exec poppy-wan supervisorctl restart comfyui || true
fi
# Restart Caddy AFTER comfyui so the 8188 -> 18188 proxy rebinds. On a cold
# reboot Caddy races ahead of ComfyUI and fails to bind 8188 (the box answers on
# SSH but not on :8188 until Caddy is bounced).
sleep 5
docker exec poppy-wan supervisorctl restart caddy || true
for i in \$(seq 1 60); do
  curl -fsS --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && { echo "comfyui reachable on 8188 at \$TAG"; break; }
  sleep 5
done
PINEOF
chmod +x /opt/poppy/pin-comfyui.sh

cat >/etc/systemd/system/poppy-wan-upgrade.service <<'UNIT'
[Unit]
Description=Pin ComfyUI to a Wan 2.2 capable tag inside poppy-wan
After=poppy-wan.service
Requires=poppy-wan.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/opt/poppy/pin-comfyui.sh
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now poppy-wan-upgrade.service || echo "!! pin-comfyui first run failed (check journalctl -u poppy-wan-upgrade)"

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
