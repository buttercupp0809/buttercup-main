#!/usr/bin/env bash
# ============================================================
# poppy-lora-training provisioning (cloud-init user-data)
#
# DO NOT RUN THIS SCRIPT DIRECTLY. It is a cloud-init user-data
# script that runs ONCE on first boot of the training box.
# Provisioning the box requires explicit human approval per repo
# guardrails (CLAUDE.md). Running it outside of EC2 cloud-init
# context will silently fail or corrupt the local filesystem.
#
# What it does:
#   1. Installs kohya_ss (SDXL LoRA trainer) as a systemd service.
#   2. Installs ComfyUI (ai-dock image) for validation image generation.
#   3. Downloads and bakes into EBS:
#        - realvisxlV50.safetensors (RealVisXL V5, primary base model)
#        - juggernautXL_v9.safetensors (fallback base model)
#        - 4x-UltraSharp.pth (upscaler for validation)
#        - antelopev2 face pack (scrfd_10g_bnkps.onnx + glintr100.onnx
#          + siblings) for ArcFace scoring
#        - buffalo_l InsightFace face analysis pack
#   4. Installs a simple training API (HTTP :8282) that accepts the
#      kohya TOML config, runs training, and reports completion.
#   5. Installs an idle auto-stop timer (poppy-lora-idle) that
#      stops the box after IDLE_MINUTES of no GPU / API activity.
#   6. Writes /opt/poppy/READY when services are up.
#
# deploy.sh prepends a _vars block defining:
#   REALVISXL_MODEL_URL JUGGERNAUT_MODEL_URL HF_TOKEN CIVITAI_TOKEN
#   IDLE_MINUTES AWS_REGION
# ============================================================
set -uxo pipefail
exec > >(tee -a /var/log/poppy-lora-userdata.log) 2>&1
echo "=== poppy-lora-training provisioning $(date -u) ==="

ROOT=/opt/poppy
MODELS=$ROOT/models/comfyui
KOHYA_DIR=$ROOT/kohya_ss
mkdir -p \
  "$MODELS/checkpoints" \
  "$MODELS/loras" \
  "$MODELS/upscale_models" \
  "$MODELS/insightface/models/antelopev2" \
  "$MODELS/insightface/models/buffalo_l" \
  "$ROOT/comfyui-data" \
  "$ROOT/training-jobs"
chmod -R 777 "$ROOT"

# ---- swap (24GB) -------------------------------------------
# SDXL safetensors mmap spikes host RAM during load; 24GB swap absorbs it.
# Persisted via fstab so it survives stop/start and reboots.
if ! swapon --show 2>/dev/null | grep -q /swapfile; then
  dd if=/dev/zero of=/swapfile bs=1M count=24576 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
fi

# ---- helper: authenticated download (idempotent) -----------
dl() {  # dl <url> <dest> [token]
  local url="$1" dest="$2" token="${3:-}"
  [[ -z "$url" ]] && { echo "!! no URL for $dest - skipping"; return 0; }
  [[ -s "$dest" ]] && { echo "== already have $dest"; return 0; }
  echo "== downloading $dest"
  if [[ -n "$token" ]]; then
    curl -fL --retry 5 --retry-delay 5 -H "Authorization: Bearer $token" "$url" -o "$dest" \
      || echo "!! download failed: $url"
  else
    curl -fL --retry 5 --retry-delay 5 "$url" -o "$dest" \
      || echo "!! download failed: $url"
  fi
}

# ---- base model checkpoints (persist on EBS across stop/start) ----
# realvisxlV50.safetensors: canonical filename for base model "realvisxl_v5".
# Referenced as REALVISXL_CHECKPOINT in backend/src/media/handlers/image.ts.
# Required for LoRA validation image generation on this box.
dl "${REALVISXL_MODEL_URL:-}" "$MODELS/checkpoints/realvisxlV50.safetensors" "${HF_TOKEN:-}"
# juggernautXL_v9.safetensors: fallback base model (base model "juggernaut_xl_v9").
dl "${JUGGERNAUT_MODEL_URL:-}" "$MODELS/checkpoints/juggernautXL_v9.safetensors" "${CIVITAI_TOKEN:-${HF_TOKEN:-}}"

# ---- upscaler (validation quality pass) --------------------
# 4x-UltraSharp: standard ESRGAN upscaler; used in the validation ComfyUI
# workflow to sharpen generated images before ArcFace scoring.
dl "https://huggingface.co/Kim2091/4xUltraSharp/resolve/main/4x-UltraSharp.pth" \
   "$MODELS/upscale_models/4x-UltraSharp.pth" ""

# ---- InsightFace / ArcFace models --------------------------
# antelopev2: the face analysis pack used by ArcFace scoring in dataset
# preparation (buildDataset in dataset.ts) and checkpoint validation
# (validateCheckpoint in validate.ts). Scorer: BoxArcfaceScorer (arcface.ts).
# The five .onnx files are the full antelopev2 bundle required by InsightFace.
ANTELOPE="$MODELS/insightface/models/antelopev2"
for f in 1k3d68.onnx 2d106det.onnx genderage.onnx glintr100.onnx scrfd_10g_bnkps.onnx; do
  dl "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main/$f" "$ANTELOPE/$f" ""
done

# buffalo_l: default InsightFace face analysis pack (heavier than antelopev2;
# used by the existing PoppyFaceSwap node and as a fallback in case antelopev2
# detection fails on some face crops).
BUFFALO="$MODELS/insightface/models/buffalo_l"
for f in 1k3d68.onnx 2d106det.onnx genderage.onnx glintr100.onnx scrfd_10g_bnkps.onnx; do
  dl "https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/insightface/models/buffalo_l/$f" \
     "$BUFFALO/$f" "" || true
done

chmod -R 777 "$MODELS/insightface" "$MODELS/checkpoints" "$MODELS/upscale_models"

# ============================================================
# kohya_ss (SDXL LoRA trainer)
#
# Installed via pip into a dedicated venv. The sdxl_train_network.py script
# is the entrypoint; the training API (see below) calls it with a --config_file
# pointing to the TOML produced by buildKohyaConfig in train.ts.
# ============================================================
apt-get install -y python3-venv python3-dev git >/dev/null 2>&1 || true

KOHYA_VENV="$KOHYA_DIR/venv"
if [ ! -d "$KOHYA_DIR/.git" ]; then
  git clone --depth 1 https://github.com/kohya-ss/sd-scripts "$KOHYA_DIR"
else
  echo "exists: $KOHYA_DIR (skip clone)"
fi

if [ ! -f "$KOHYA_VENV/bin/python" ]; then
  python3 -m venv "$KOHYA_VENV"
  # Install torch with CUDA first (index-url before other packages).
  "$KOHYA_VENV/bin/pip" install --quiet torch torchvision --index-url https://download.pytorch.org/whl/cu121
  # Install kohya deps; strip torch lines so we do not downgrade the CUDA torch.
  grep -viE '^(torch|torchvision|torchaudio)' "$KOHYA_DIR/requirements.txt" > /tmp/kohya-req.txt
  "$KOHYA_VENV/bin/pip" install --quiet -r /tmp/kohya-req.txt
  "$KOHYA_VENV/bin/pip" install --quiet insightface onnxruntime-gpu xformers
else
  echo "exists: $KOHYA_VENV (skip pip install)"
fi
chmod -R 777 "$KOHYA_DIR"

# ============================================================
# Training API (HTTP :8282)
#
# A minimal Python HTTP server that:
#   POST /train   - accepts JSON {jobId, tomlConfig, datasetDir}
#                   writes the TOML file, runs kohya sdxl_train_network.py,
#                   streams stdout to a log file at $ROOT/training-jobs/<jobId>.log
#                   returns {ok:true, jobId} synchronously (training runs async).
#   GET /status/<jobId> - returns {state:"running"|"done"|"failed", log:<tail>}
#   GET /health   - returns {ok:true}
# The BullMQ worker (Task 13) connects to this API via the training box IP.
# The port (8282) is only open to the backend SG; it is NOT accessible from
# the public internet.
# ============================================================
mkdir -p "$ROOT/training-api"
cat >"$ROOT/training-api/server.py" <<'PYEOF'
#!/usr/bin/env python3
"""
Minimal training API for poppy-lora-training box.

Listens on :8282. Accepts a TOML config from the BullMQ worker (Task 13),
runs kohya_ss sdxl_train_network.py asynchronously, and reports job state.

NOT a general-purpose API: one job at a time (protected by a lock file).
"""
import http.server
import json
import os
import subprocess
import threading
import tempfile
from pathlib import Path

ROOT = Path("/opt/poppy")
JOBS_DIR = ROOT / "training-jobs"
KOHYA_PY = ROOT / "kohya_ss" / "venv" / "bin" / "python"
KOHYA_SCRIPT = ROOT / "kohya_ss" / "sdxl_train_network.py"
LOCK_FILE = ROOT / ".training-lock"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

_jobs: dict[str, str] = {}  # jobId -> "running" | "done" | "failed"
_lock = threading.Lock()


def _run_training(job_id: str, toml_path: str, log_path: str) -> None:
    try:
        with open(log_path, "w") as log_f:
            proc = subprocess.run(
                [str(KOHYA_PY), str(KOHYA_SCRIPT), "--config_file", toml_path],
                stdout=log_f, stderr=subprocess.STDOUT, text=True
            )
        with _lock:
            _jobs[job_id] = "done" if proc.returncode == 0 else "failed"
    except Exception as exc:
        with open(log_path, "a") as log_f:
            log_f.write(f"\n!! error: {exc}\n")
        with _lock:
            _jobs[job_id] = "failed"
    finally:
        LOCK_FILE.unlink(missing_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # suppress default access log
        pass

    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        if self.path.startswith("/status/"):
            job_id = self.path.split("/status/", 1)[1].strip("/")
            with _lock:
                state = _jobs.get(job_id, "unknown")
            log_path = JOBS_DIR / f"{job_id}.log"
            tail = ""
            if log_path.exists():
                lines = log_path.read_text().splitlines()
                tail = "\n".join(lines[-40:])
            self._json(200, {"state": state, "jobId": job_id, "log": tail})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/train":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            job_id = body.get("jobId", "")
            toml_config = body.get("tomlConfig", "")
            if not job_id or not toml_config:
                self._json(400, {"error": "jobId and tomlConfig are required"})
                return
            if LOCK_FILE.exists():
                self._json(409, {"error": "another training job is already running"})
                return
            toml_path = str(JOBS_DIR / f"{job_id}.toml")
            log_path = str(JOBS_DIR / f"{job_id}.log")
            Path(toml_path).write_text(toml_config)
            LOCK_FILE.touch()
            with _lock:
                _jobs[job_id] = "running"
            threading.Thread(
                target=_run_training, args=(job_id, toml_path, log_path), daemon=True
            ).start()
            self._json(200, {"ok": True, "jobId": job_id})
            return
        self._json(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(os.environ.get("TRAINING_API_PORT", "8282"))
    srv = http.server.HTTPServer(("0.0.0.0", port), Handler)
    print(f"training-api listening on :{port}", flush=True)
    srv.serve_forever()
PYEOF
chmod +x "$ROOT/training-api/server.py"

# ============================================================
# ComfyUI systemd service (ai-dock image, for validation renders)
# ============================================================
COMFYUI_IMAGE="${COMFYUI_IMAGE:-aidockorg/comfyui-cuda:latest}"
docker pull "$COMFYUI_IMAGE" || true

# Bake a ComfyUI image with InsightFace + insightface-related custom nodes
# for ArcFace face scoring during validation. torch lines stripped from all
# requirements files so the CUDA torch installed in the base image is not
# replaced (same guard used in inference-aws and inference-video-aws).
cat >/opt/poppy/comfyui-lora.Dockerfile <<DOCKER
FROM $COMFYUI_IMAGE
RUN /opt/environments/python/comfyui/bin/pip install --no-cache-dir insightface onnxruntime-gpu
RUN git clone --depth 1 https://github.com/cubiq/ComfyUI_InstantID /opt/ComfyUI/custom_nodes/ComfyUI_InstantID \\
 && /opt/environments/python/comfyui/bin/pip install --no-cache-dir -r /opt/ComfyUI/custom_nodes/ComfyUI_InstantID/requirements.txt || true
DOCKER
docker build -t poppy-comfyui-lora:local -f /opt/poppy/comfyui-lora.Dockerfile /opt/poppy || true

cat >/etc/systemd/system/poppy-lora-comfyui.service <<UNIT
[Unit]
Description=poppy-lora ComfyUI (validation renders) :8188
After=docker.service
Requires=docker.service
[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f poppy-lora-comfyui
ExecStart=/usr/bin/docker run --rm --name poppy-lora-comfyui --gpus all -e WEB_ENABLE_AUTH=false -p 8188:8188 -v $MODELS/checkpoints:/opt/ComfyUI/models/checkpoints -v $MODELS/loras:/opt/ComfyUI/models/loras -v $MODELS/upscale_models:/opt/ComfyUI/models/upscale_models -v $MODELS/insightface:/opt/ComfyUI/models/insightface -v $ROOT/comfyui-data:/opt/ComfyUI/output poppy-comfyui-lora:local
ExecStop=/usr/bin/docker stop poppy-lora-comfyui
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-lora-comfyui.service || echo "!! comfyui unit file is empty"

# ============================================================
# Training API systemd service
# ============================================================
cat >/etc/systemd/system/poppy-lora-training-api.service <<UNIT
[Unit]
Description=poppy LoRA training API :8282
After=network.target
[Service]
Restart=always
RestartSec=5
Environment="TRAINING_API_PORT=8282"
ExecStart=/opt/poppy/kohya_ss/venv/bin/python /opt/poppy/training-api/server.py
WorkingDirectory=/opt/poppy/training-api
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-lora-training-api.service || echo "!! training-api unit file is empty"

# ============================================================
# Idle auto-stop
#
# Stops the box after IDLE_MINUTES with no GPU activity, no open
# connections on :8282 or :8188, and no training job lock file.
# SHUTDOWN_BEHAVIOR=stop (set at launch) makes `shutdown -h` STOP,
# not terminate, so EBS is preserved.
# ============================================================
cat >/opt/poppy/idle-check.sh <<'IDEOF'
#!/usr/bin/env bash
set -uo pipefail
IDLE_MINUTES="__IDLE_MINUTES__"
STAMP=/opt/poppy/.last-active
LOCK=/opt/poppy/.training-lock
now=$(date +%s)

# Admin keepalive: touch /opt/poppy/.keepalive to prevent idle-stop during
# manual work (model uploads, debugging). Remove when done.
if [[ -f /opt/poppy/.keepalive ]]; then
  echo "$now" > "$STAMP"; echo "keepalive lock present"; exit 0
fi

# Active SSH session also blocks idle-stop.
ssh_conns=$(ss -Htn state established '( sport = :22 )' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$ssh_conns" -gt 0 ]]; then
  echo "$now" > "$STAMP"; echo "active ssh session"; exit 0
fi

# Training job in progress (lock file left by training-api/server.py).
if [[ -f "$LOCK" ]]; then
  echo "$now" > "$STAMP"; echo "training job in progress"; exit 0
fi

# GPU busy?
util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
[[ -z "$util" ]] && util=0

# Open connections on training API (:8282) or ComfyUI (:8188)?
conns=$(ss -Htn state established '( sport = :8282 or sport = :8188 )' 2>/dev/null | wc -l | tr -d ' ')

if [[ "$util" -ge 5 || "$conns" -gt 0 ]]; then
  echo "$now" > "$STAMP"; exit 0
fi

[[ -f "$STAMP" ]] || { echo "$now" > "$STAMP"; exit 0; }
last=$(cat "$STAMP"); idle=$(( (now - last) / 60 ))
echo "idle ${idle}m (util=${util}% conns=${conns})"
if [[ "$idle" -ge "$IDLE_MINUTES" ]]; then
  logger -t poppy-lora-idle "idle ${idle}m >= ${IDLE_MINUTES}m - stopping instance"
  /sbin/shutdown -h now
fi
IDEOF
sed -i "s/__IDLE_MINUTES__/${IDLE_MINUTES:-30}/" /opt/poppy/idle-check.sh
chmod +x /opt/poppy/idle-check.sh

cat >/etc/systemd/system/poppy-lora-idle.service <<'UNIT'
[Unit]
Description=poppy-lora idle auto-stop check
[Service]
Type=oneshot
ExecStart=/opt/poppy/idle-check.sh
UNIT

cat >/etc/systemd/system/poppy-lora-idle.timer <<'UNIT'
[Unit]
Description=run poppy-lora idle check every 5 min
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT

# ============================================================
# Enable and start everything
# ============================================================
systemctl daemon-reload
systemctl enable --now poppy-lora-comfyui.service
systemctl enable --now poppy-lora-training-api.service
systemctl enable --now poppy-lora-idle.timer
echo "$(date +%s)" > /opt/poppy/.last-active

# Wait for ComfyUI to answer.
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "comfyui up"; break
  fi
  sleep 10
done

# Wait for training API to answer.
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8282/health >/dev/null 2>&1; then
    echo "training-api up"; break
  fi
  sleep 5
done

# Daily docker image prune (keeps disk clean between training runs).
cat >/etc/cron.daily/poppy-lora-docker-prune <<'CRON'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1
docker builder prune -af >/dev/null 2>&1
CRON
chmod +x /etc/cron.daily/poppy-lora-docker-prune

echo "READY $(date -u)" > "$ROOT/READY"
echo "=== poppy-lora-training provisioning done $(date -u) ==="
