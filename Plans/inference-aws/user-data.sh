#!/usr/bin/env bash
# ============================================================
# poppy-inference - instance provisioning (cloud-init user-data)
#
# Runs ONCE on first boot. Installs everything as systemd
# services so Stheno + Juggernaut come back automatically on every
# subsequent start (after a stop/start cycle) with no rerun.
#
# 10-deploy.sh prepends a _vars block defining:
#   STHENO_GGUF_URL STHENO_GGUF_NAME JUGGERNAUT_MODEL_URL JUGGERNAUT_MODEL_NAME
#   HF_TOKEN CIVITAI_TOKEN IDLE_MINUTES AWS_REGION STHENO_CTX
#   LLAMACPP_IMAGE COMFYUI_IMAGE
# ============================================================
set -uxo pipefail
exec > >(tee -a /var/log/poppy-userdata.log) 2>&1
echo "=== poppy-inference provisioning $(date -u) ==="

ROOT=/opt/poppy
MODELS=$ROOT/models
mkdir -p "$MODELS/stheno" "$MODELS/comfyui/checkpoints" "$ROOT/comfyui-data"
# ComfyUI (ai-dock) runs as a non-root user; make the output mount writable
# so SaveImage can persist generated PNGs (retrieved via the /view API).
chmod 777 "$ROOT/comfyui-data"

# ---- swap (CRITICAL) ---------------------------------------
# g6.xlarge has only 16GB RAM. Loading the 6.5GB SDXL checkpoint (ComfyUI)
# while llama.cpp holds the 5.7GB GGUF in page cache overruns RAM and OOM-hangs
# the box. A 16GB swapfile absorbs the transient load-time spike; once both
# models are in VRAM (24GB, plenty) RAM pressure drops. Persisted via fstab so
# it survives stop/start and reboots.
if ! swapon --show 2>/dev/null | grep -q /swapfile; then
  dd if=/dev/zero of=/swapfile bs=1M count=16384 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
fi

# ---- helper: authenticated download (skips if present) -----
dl() {  # dl <url> <dest> <token>
  local url="$1" dest="$2" token="${3:-}"
  [[ -z "$url" ]] && { echo "!! no URL for $dest - skipping"; return 0; }
  [[ -s "$dest" ]] && { echo "== already have $dest"; return 0; }
  echo "== downloading $dest"
  if [[ -n "$token" ]]; then
    curl -fL --retry 4 -H "Authorization: Bearer $token" "$url" -o "$dest" || echo "!! download failed: $url"
  else
    curl -fL --retry 4 "$url" -o "$dest" || echo "!! download failed: $url"
  fi
}

# ---- models (persist on EBS across stop/start) -------------
dl "$STHENO_GGUF_URL" "$MODELS/stheno/$STHENO_GGUF_NAME" "$HF_TOKEN"
dl "$JUGGERNAUT_MODEL_URL"  "$MODELS/comfyui/checkpoints/$JUGGERNAUT_MODEL_NAME" "${CIVITAI_TOKEN:-$HF_TOKEN}"

# ---- InstantID models (same face across new poses/backgrounds) ----
# InstantID embeds the persona's face and locks it onto fresh txt2img
# generations, so pose/outfit/background come from the prompt while identity
# holds. Needs: the ip-adapter, a face ControlNet, and the antelopev2 face pack.
INSTANTID_DIR="$MODELS/comfyui/instantid"
CN_DIR="$MODELS/comfyui/controlnet"
ANTELOPE_DIR="$MODELS/comfyui/insightface/models/antelopev2"
mkdir -p "$INSTANTID_DIR" "$CN_DIR" "$ANTELOPE_DIR"
dl "https://huggingface.co/InstantX/InstantID/resolve/main/ip-adapter.bin" "$INSTANTID_DIR/ip-adapter.bin" ""
dl "https://huggingface.co/InstantX/InstantID/resolve/main/ControlNetModel/diffusion_pytorch_model.safetensors" "$CN_DIR/instantid_control.safetensors" ""
for f in 1k3d68.onnx 2d106det.onnx genderage.onnx glintr100.onnx scrfd_10g_bnkps.onnx; do
  dl "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main/$f" "$ANTELOPE_DIR/$f" ""
done
chmod -R 777 "$MODELS/comfyui/instantid" "$MODELS/comfyui/controlnet" "$MODELS/comfyui/insightface"

# ---- FaceDetailer (face bbox detector) + FaceSwap (inswapper) models --------
# FaceDetailer re-diffuses the face at high res (fixes weak faces on full-body).
# inswapper copies the EXACT reference face for true character consistency.
YOLO_DIR="$MODELS/comfyui/ultralytics/bbox"
mkdir -p "$YOLO_DIR" "$MODELS/comfyui/ultralytics/segm"
dl "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" "$YOLO_DIR/face_yolov8m.pt" ""
dl "https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx" "$MODELS/comfyui/insightface/inswapper_128.onnx" ""
# GPEN-BFR-512 face restorer (ONNX): sharpens the soft 128px inswapper face to
# a crisp 512px face. Runs via onnxruntime, so no basicsr/torchvision issues.
dl "https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GPEN-BFR-512.onnx" "$MODELS/comfyui/insightface/GPEN-BFR-512.onnx" ""
chmod -R 777 "$MODELS/comfyui/ultralytics" "$MODELS/comfyui/insightface"

# ---- Image-quality refinement models (2026-08-23) --------------------------
# Additive only; does not touch the InstantID + inswapper identity lock above.
# Each is gated behind a backend A/B flag (IMG_HAND_DETAILER / IMG_POSE_CONTROLNET
# / IMG_PULID) and the workflow builder falls back to the current graph when a
# node/model is missing, so a failed download here never breaks generation.
#
# Fix 3 (hands): hand bbox detector for the hands-only DetailerForEach pass. The
# DetailerForEach + UltralyticsDetectorProvider nodes ship in Impact Pack/Subpack
# (already installed below), so only the model file is new.
dl "https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov9c.pt" "$YOLO_DIR/hand_yolov9c.pt" ""
# Fallback hand model if yolov9c is unavailable at build time.
dl "https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov8s.pt" "$YOLO_DIR/hand_yolov8s.pt" ""
# Fix 4 (poses): xinsir OpenPose SDXL ControlNet (body pose; head keypoints are
# stripped in the workflow so the head stays free to rotate).
dl "https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors" "$CN_DIR/controlnet-openpose-sdxl-1.0.safetensors" ""
# Fix 2 (angled faces): PuLID-SDXL identity weights for the yaw-gated branch.
# VERIFY at the Fix 4/5 node-rebuild: guozinan/PuLID hosts the FLUX PuLID weights,
# not SDXL. The SDXL weights are under huchenlei/ipadapter_pulid. Confirm the exact
# filename PuLID_ComfyUI expects before enabling IMG_PULID.
PULID_DIR="$MODELS/comfyui/pulid"
mkdir -p "$PULID_DIR"
dl "https://huggingface.co/huchenlei/ipadapter_pulid/resolve/main/ip-adapter_pulid_sdxl_fp16.safetensors" "$PULID_DIR/ip-adapter_pulid_sdxl_fp16.safetensors" ""
chmod -R 777 "$MODELS/comfyui/ultralytics" "$MODELS/comfyui/insightface" "$MODELS/comfyui/controlnet" "$PULID_DIR"

# ---- filter-free face swap custom node (no NSFW blocking) -------------------
mkdir -p "$ROOT/custom_nodes/PoppyFaceSwap"
cat >"$ROOT/custom_nodes/PoppyFaceSwap/__init__.py" <<'PYEOF'
# Filter-free face swap + high-res face restoration (no NSFW filter).
# Single-pass approach: inswapper runs with paste_back=False (no paste),
# result is upscaled to 512px, GPEN restores it, then ONE feathered paste-back
# uses an ellipse mask. This eliminates the double-seam halo that appeared at
# chin/cheeks when inswapper and GPEN each did independent paste operations
# with different mask shapes and blur widths.
import os
import numpy as np
import torch
import cv2
import insightface
from insightface.app import FaceAnalysis
from insightface.utils import face_align
import onnxruntime as ort
import folder_paths


class PoppyFaceSwap:
    _app = None
    _swapper = None
    _gpen = None
    _gpen_io = None

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"target_image": ("IMAGE",), "source_image": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "swap"
    CATEGORY = "poppy"

    def _load(self):
        root = os.path.join(folder_paths.models_dir, "insightface")
        if PoppyFaceSwap._app is None:
            app = FaceAnalysis(name="buffalo_l", root=root, providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=0, det_size=(640, 640))
            PoppyFaceSwap._app = app
        if PoppyFaceSwap._swapper is None:
            PoppyFaceSwap._swapper = insightface.model_zoo.get_model(
                os.path.join(root, "inswapper_128.onnx"), providers=["CPUExecutionProvider"]
            )
        if PoppyFaceSwap._gpen is None:
            gpath = os.path.join(root, "GPEN-BFR-512.onnx")
            if os.path.exists(gpath):
                sess = ort.InferenceSession(gpath, providers=["CPUExecutionProvider"])
                PoppyFaceSwap._gpen = sess
                PoppyFaceSwap._gpen_io = (sess.get_inputs()[0].name, sess.get_outputs()[0].name)

    @staticmethod
    def _to_cv(img):
        arr = (img[0].cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

    @staticmethod
    def _to_tensor(bgr):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return torch.from_numpy(rgb)[None,]

    def _gpen_restore(self, aligned_bgr):
        rgb = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - 0.5) / 0.5
        blob = np.transpose(rgb, (2, 0, 1))[None].astype(np.float32)
        iname, oname = PoppyFaceSwap._gpen_io
        out = PoppyFaceSwap._gpen.run([oname], {iname: blob})[0][0]
        out = np.clip(out, -1, 1)
        out = (out + 1) / 2
        out = np.transpose(out, (1, 2, 0)) * 255.0
        return cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)

    def swap(self, target_image, source_image):
        self._load()
        tgt = self._to_cv(target_image)
        src = self._to_cv(source_image)
        src_faces = PoppyFaceSwap._app.get(src)
        tgt_faces = PoppyFaceSwap._app.get(tgt)
        if not src_faces or not tgt_faces:
            return (target_image,)
        src_face = max(src_faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        out = tgt.copy()
        h, w = tgt.shape[:2]
        for f in tgt_faces:
            # Step 1: swap in 128px aligned space, no paste_back so inswapper
            # does not do its own narrow-mask blend (that was seam #1).
            result = PoppyFaceSwap._swapper.get(tgt, f, src_face, paste_back=False)
            swapped_128 = result[0] if isinstance(result, tuple) else result
            # Step 2: upscale 128->512 then GPEN restore.
            face_512 = cv2.resize(swapped_128, (512, 512), interpolation=cv2.INTER_LANCZOS4)
            if PoppyFaceSwap._gpen is not None:
                face_512 = self._gpen_restore(face_512)
            # Step 3: single paste-back at 512px with an ellipse mask.
            # Ellipse covers the face region without square corners; square
            # corners land at chin/cheeks and were the visible halo source.
            M512 = face_align.estimate_norm(f.kps, image_size=512)
            IM512 = cv2.invertAffineTransform(M512)
            back = cv2.warpAffine(face_512, IM512, (w, h), borderMode=cv2.BORDER_REPLICATE)
            mask512 = np.zeros((512, 512), np.uint8)
            cv2.ellipse(mask512, (256, 270), (230, 255), 0, 0, 360, 255, -1)
            mask512 = cv2.dilate(mask512, np.ones((15, 15), np.uint8), iterations=1)
            mask_img = cv2.warpAffine(mask512, IM512, (w, h))
            mask_img = cv2.GaussianBlur(mask_img, (0, 0), 20)
            m = (mask_img.astype(np.float32) / 255.0)[..., None]
            out = (back.astype(np.float32) * m + out.astype(np.float32) * (1 - m)).astype(np.uint8)
        return (self._to_tensor(out),)


NODE_CLASS_MAPPINGS = {"PoppyFaceSwap": PoppyFaceSwap}
NODE_DISPLAY_NAME_MAPPINGS = {"PoppyFaceSwap": "Poppy Face Swap (filter-free + GPEN)"}
PYEOF
chmod -R 777 "$ROOT/custom_nodes"

# ============================================================
# Stheno - llama.cpp OpenAI-compatible server on :8001
# ============================================================
docker pull "$LLAMACPP_IMAGE" || true
cat >/etc/systemd/system/poppy-stheno.service <<EOF
[Unit]
Description=poppy Stheno (llama.cpp) API :8001
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f poppy-stheno
ExecStart=/usr/bin/docker run --rm --name poppy-stheno --gpus all \\
  -p 8001:8001 -v $MODELS/stheno:/models \\
  $LLAMACPP_IMAGE \\
  -m /models/$STHENO_GGUF_NAME --host 0.0.0.0 --port 8001 -ngl 99 -c $STHENO_CTX
ExecStop=/usr/bin/docker stop poppy-stheno

[Install]
WantedBy=multi-user.target
EOF

# ============================================================
# Juggernaut - ComfyUI + InstantID + FaceDetailer + FaceSwap on :8188
# ============================================================
docker pull "$COMFYUI_IMAGE" || true
# Bake one image with: InstantID node (+insightface/onnxruntime), Impact Pack
# FaceDetailer (PINNED to a Sept-2024 commit - this ai-dock ComfyUI predates
# the API that Impact Pack V8 needs), Impact Subpack (detector), and the deps
# for the filter-free faceswap node. sam2 and torch lines are stripped so the
# CUDA torch is never replaced. Big model files stay on the EBS mounts below.
cat >/opt/poppy/comfyui.Dockerfile <<DOCKER
FROM $COMFYUI_IMAGE
RUN /opt/environments/python/comfyui/bin/pip install --no-cache-dir insightface onnxruntime ultralytics segment-anything
RUN git clone --depth 1 https://github.com/cubiq/ComfyUI_InstantID /opt/ComfyUI/custom_nodes/ComfyUI_InstantID \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /opt/ComfyUI/custom_nodes/ComfyUI_InstantID/requirements.txt || true
RUN git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack /opt/ComfyUI/custom_nodes/ComfyUI-Impact-Pack \\
 && cd /opt/ComfyUI/custom_nodes/ComfyUI-Impact-Pack \\
 && git checkout \$(git rev-list -1 --before="2024-09-06" HEAD) \\
 && grep -viE 'sam2|^torch|^torchvision|^torchaudio' requirements.txt > /tmp/ipreq.txt \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /tmp/ipreq.txt || true
RUN git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Subpack /opt/ComfyUI/custom_nodes/ComfyUI-Impact-Subpack \\
 && grep -viE 'sam2|^torch|^torchvision|^torchaudio' /opt/ComfyUI/custom_nodes/ComfyUI-Impact-Subpack/requirements.txt > /tmp/spreq.txt \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /tmp/spreq.txt || true
# ---- Image-quality refinement custom nodes (2026-08-23, additive) ----------
# torch lines stripped from each requirements file so the CUDA torch is never
# replaced (same guard as Impact Pack above). All best-effort (|| true): a node
# that fails to build is simply absent, and the backend workflow builder gates
# each fix on node availability and falls back to the current graph.
# Fix 4 (poses): DWPose preprocessor + the OpenPose skeleton editor (show_face=false).
RUN git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux /opt/ComfyUI/custom_nodes/comfyui_controlnet_aux \\
 && grep -viE '^torch|^torchvision|^torchaudio' /opt/ComfyUI/custom_nodes/comfyui_controlnet_aux/requirements.txt > /tmp/cnaux.txt \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /tmp/cnaux.txt || true
RUN git clone --depth 1 https://github.com/badjeff/comfyui-ultimate-openpose-editor /opt/ComfyUI/custom_nodes/comfyui-ultimate-openpose-editor || true
# Fix 2 (angled faces): PuLID-SDXL identity conditioning for the yaw-gated branch.
RUN git clone --depth 1 https://github.com/cubiq/PuLID_ComfyUI /opt/ComfyUI/custom_nodes/PuLID_ComfyUI \\
 && grep -viE '^torch|^torchvision|^torchaudio' /opt/ComfyUI/custom_nodes/PuLID_ComfyUI/requirements.txt > /tmp/pulidreq.txt \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /tmp/pulidreq.txt || true
DOCKER
docker build -t poppy-comfyui-full:local -f /opt/poppy/comfyui.Dockerfile /opt/poppy || true

cat >/etc/systemd/system/poppy-juggernaut.service <<EOF
[Unit]
Description=poppy Juggernaut (ComfyUI + InstantID + FaceDetailer + FaceSwap) :8188
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f poppy-juggernaut
ExecStart=/usr/bin/docker run --rm --name poppy-juggernaut --gpus all \\
  -e WEB_ENABLE_AUTH=false \\
  -p 8188:8188 \\
  -v $MODELS/comfyui/checkpoints:/opt/ComfyUI/models/checkpoints \\
  -v $MODELS/comfyui/instantid:/opt/ComfyUI/models/instantid \\
  -v $MODELS/comfyui/controlnet:/opt/ComfyUI/models/controlnet \\
  -v $MODELS/comfyui/insightface:/opt/ComfyUI/models/insightface \\
  -v $MODELS/comfyui/ultralytics:/opt/ComfyUI/models/ultralytics \\
  -v $MODELS/comfyui/pulid:/opt/ComfyUI/models/pulid \\
  -v $ROOT/custom_nodes/PoppyFaceSwap:/opt/ComfyUI/custom_nodes/PoppyFaceSwap \\
  -v $ROOT/comfyui-data:/opt/ComfyUI/output \\
  poppy-comfyui-full:local
ExecStop=/usr/bin/docker stop poppy-juggernaut

[Install]
WantedBy=multi-user.target
EOF

# ============================================================
# Idle auto-stop - self-stops the box after IDLE_MINUTES with
# no GPU activity and no open API connections. Biggest cost saver.
# SHUTDOWN_BEHAVIOR=stop (set at launch) makes `shutdown -h` STOP,
# not terminate, so nothing is lost and no extra IAM is needed.
# ============================================================
cat >/opt/poppy/idle-check.sh <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
IDLE_MINUTES="__IDLE_MINUTES__"
STAMP=/opt/poppy/.last-active
now=$(date +%s)
# Admin keepalive: a lock file (touch /opt/poppy/.keepalive) or an active SSH
# session on :22 counts as busy, so long admin work (model downloads, debug)
# is never killed by the idle timer. Remove the lock when done.
if [[ -f /opt/poppy/.keepalive ]]; then
  echo "$now" > "$STAMP"; echo "keepalive lock present"; exit 0
fi
ssh_conns=$(ss -Htn state established '( sport = :22 )' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$ssh_conns" -gt 0 ]]; then
  echo "$now" > "$STAMP"; echo "active ssh session"; exit 0
fi
# GPU busy?
util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
[[ -z "$util" ]] && util=0
# Open API connections?
conns=$(ss -Htn state established '( sport = :8001 or sport = :8188 )' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$util" -ge 5 || "$conns" -gt 0 ]]; then
  echo "$now" > "$STAMP"; exit 0
fi
[[ -f "$STAMP" ]] || { echo "$now" > "$STAMP"; exit 0; }
last=$(cat "$STAMP"); idle=$(( (now - last) / 60 ))
echo "idle ${idle}m (util=${util}% conns=${conns})"
if [[ "$idle" -ge "$IDLE_MINUTES" ]]; then
  logger -t poppy-idle "idle ${idle}m >= ${IDLE_MINUTES}m - stopping instance"
  /sbin/shutdown -h now
fi
EOF
sed -i "s/__IDLE_MINUTES__/${IDLE_MINUTES}/" /opt/poppy/idle-check.sh
chmod +x /opt/poppy/idle-check.sh

cat >/etc/systemd/system/poppy-idle.service <<'EOF'
[Unit]
Description=poppy idle auto-stop check
[Service]
Type=oneshot
ExecStart=/opt/poppy/idle-check.sh
EOF
cat >/etc/systemd/system/poppy-idle.timer <<'EOF'
[Unit]
Description=run poppy idle check every 5 min
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF

# ---- enable + start everything -----------------------------
systemctl daemon-reload
systemctl enable --now poppy-stheno.service
systemctl enable --now poppy-juggernaut.service
# Idle auto-stop is OFF in 24/7 mode. Only enable the timer if explicitly asked
# (ENABLE_IDLE_STOP=true). The unit files are always written so it can be
# switched on later with: systemctl enable --now poppy-idle.timer
if [[ "${ENABLE_IDLE_STOP:-false}" == "true" ]]; then
  systemctl enable --now poppy-idle.timer
else
  systemctl disable --now poppy-idle.timer 2>/dev/null || true
fi
echo "$(date +%s)" > /opt/poppy/.last-active

# ---- keep disk clean (the "garbage") -----------------------
cat >/etc/cron.daily/poppy-docker-prune <<'EOF'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1
docker builder prune -af >/dev/null 2>&1
EOF
chmod +x /etc/cron.daily/poppy-docker-prune

echo "=== provisioning complete $(date -u) ==="
