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
  # insightface + onnxruntime-gpu: ArcFace scoring (arcface-api/server.py :8184).
  # fastapi + uvicorn: HTTP servers for arcface-api and caption-api.
  # boto3: checkpoint S3 upload inside training-api/server.py.
  # huggingface_hub + timm + Pillow: WD14 tagger for caption-api/server.py :8185.
  "$KOHYA_VENV/bin/pip" install --quiet insightface onnxruntime-gpu xformers \
    fastapi "uvicorn[standard]" boto3 \
    huggingface_hub timm Pillow numpy
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

After kohya finishes successfully, uploads all produced .safetensors checkpoint
files to S3 and populates the checkpoints array in the job state. This satisfies
the contract expected by training-client.ts#collectCheckpoints:

  GET /status/<jobId> -> {
    state: "done",
    jobId: string,
    checkpoints: [ { step: number, key: string }, ... ],
    log: string
  }

Required env vars for S3 upload:
  S3_BUCKET         - bucket name (POPPY_S3_BUCKET_GENERATED from the backend,
                      passed in as S3_BUCKET here for simplicity; set in the
                      systemd unit via EnvironmentFile or deploy.sh)
  AWS_REGION        - e.g. "eu-north-1" (must match the bucket region)
  AWS_ACCESS_KEY_ID     - EC2 instance profile provides this automatically when
  AWS_SECRET_ACCESS_KEY   the instance has the required IAM role attached.
                          Explicit keys are only needed for testing outside EC2.

IAM requirement: the instance profile must include s3:PutObject on
  arn:aws:s3:::<S3_BUCKET>/lora/*
"""
import http.server
import json
import os
import re
import subprocess
import threading
from pathlib import Path

ROOT = Path("/opt/poppy")
JOBS_DIR = ROOT / "training-jobs"
KOHYA_PY = ROOT / "kohya_ss" / "venv" / "bin" / "python"
KOHYA_SCRIPT = ROOT / "kohya_ss" / "sdxl_train_network.py"
LOCK_FILE = ROOT / ".training-lock"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# _jobs maps jobId -> { state, checkpoints: [{step, key}], output_dir }
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _s3_upload_checkpoints(output_dir: Path, job_id: str) -> list[dict]:
    """
    Upload all .safetensors files in output_dir to S3.
    Key pattern: lora/<outputName>/<jobId>/step-<step>.safetensors
    where outputName is inferred from the safetensors filename (kohya names them
    <outputName>-<step>.safetensors or <outputName>.safetensors for the final).

    Returns a list of { step: int, key: str } dicts sorted by step ascending.
    Returns [] if S3_BUCKET env var is not set (non-fatal; caller returns empty
    checkpoints array and validate.ts will fail with a clear message).
    """
    bucket = os.environ.get("S3_BUCKET", "")
    region = os.environ.get("AWS_REGION", "eu-north-1")
    if not bucket:
        print("!! S3_BUCKET not set; skipping checkpoint upload", flush=True)
        return []

    try:
        import boto3  # type: ignore
    except ImportError:
        print("!! boto3 not installed; skipping checkpoint upload", flush=True)
        return []

    s3 = boto3.client("s3", region_name=region)
    safetensors_files = sorted(output_dir.glob("*.safetensors"))
    results = []

    for sf in safetensors_files:
        # kohya saves files as: <outputName>-<NNN>.safetensors or <outputName>.safetensors
        stem = sf.stem  # e.g. "ch_abc123-000500" or "ch_abc123"
        step_match = re.search(r"-(\d+)$", stem)
        step = int(step_match.group(1)) if step_match else 1500  # final checkpoint = last step
        # outputName is everything before the step suffix (or the full stem for the final)
        output_name = stem[: step_match.start()] if step_match else stem
        key = f"lora/{output_name}/{job_id}/step-{step:06d}.safetensors"
        try:
            s3.upload_file(str(sf), bucket, key)
            print(f"== uploaded {sf.name} -> s3://{bucket}/{key}", flush=True)
            results.append({"step": step, "key": key})
        except Exception as exc:
            print(f"!! failed to upload {sf.name}: {exc}", flush=True)

    results.sort(key=lambda c: c["step"])
    return results


def _run_training(job_id: str, toml_path: str, log_path: str, output_dir: str) -> None:
    try:
        with open(log_path, "w") as log_f:
            proc = subprocess.run(
                [str(KOHYA_PY), str(KOHYA_SCRIPT), "--config_file", toml_path],
                stdout=log_f, stderr=subprocess.STDOUT, text=True
            )
        if proc.returncode == 0:
            checkpoints = _s3_upload_checkpoints(Path(output_dir), job_id)
            with _lock:
                _jobs[job_id]["state"] = "done"
                _jobs[job_id]["checkpoints"] = checkpoints
        else:
            with _lock:
                _jobs[job_id]["state"] = "failed"
    except Exception as exc:
        with open(log_path, "a") as log_f:
            log_f.write(f"\n!! error: {exc}\n")
        with _lock:
            _jobs[job_id]["state"] = "failed"
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
                job = _jobs.get(job_id)
                if job:
                    state = job["state"]
                    checkpoints = list(job.get("checkpoints", []))
                else:
                    state = "unknown"
                    checkpoints = []
            log_path = JOBS_DIR / f"{job_id}.log"
            tail = ""
            if log_path.exists():
                lines = log_path.read_text().splitlines()
                tail = "\n".join(lines[-40:])
            # checkpoints is [] while running; populated on done.
            # training-client.ts#collectCheckpoints reads body.checkpoints.
            self._json(200, {
                "state": state,
                "jobId": job_id,
                "checkpoints": checkpoints,
                "log": tail,
            })
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
            # Parse output_dir from the TOML so we know where to find .safetensors files.
            # buildKohyaConfig writes: output_dir = "<datasetDir>/output"
            output_dir = ""
            for line in toml_config.splitlines():
                m = re.match(r'^\s*output_dir\s*=\s*"([^"]+)"', line)
                if m:
                    output_dir = m.group(1)
                    break
            if not output_dir:
                # Fallback: use the job dir (avoids a 400; upload will find nothing).
                output_dir = str(JOBS_DIR)
            LOCK_FILE.touch()
            with _lock:
                _jobs[job_id] = {"state": "running", "checkpoints": [], "output_dir": output_dir}
            threading.Thread(
                target=_run_training,
                args=(job_id, toml_path, log_path, output_dir),
                daemon=True,
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
# ArcFace scoring service (HTTP :8184)
#
# Satisfies the contract expected by arcface-client.ts:
#   POST /score    { ref_key: string, candidate_key: string }
#                  -> { similarity: number }   (cosine [0..1])
#   POST /baseline { ref_key: string }
#                  -> { score: number }        (intra-identity noise floor)
#
# Both routes receive S3 key strings. The service downloads each image
# from S3 (using boto3 + S3_BUCKET + AWS_REGION), extracts the 512-dim
# ArcFace/glintr100 embedding via InsightFace (antelopev2 pack baked
# into EBS at /opt/poppy/models/comfyui/insightface/models/antelopev2/),
# and returns cosine similarity.
#
# /baseline computes embedding distance between two crops of the SAME
# reference image (a horizontal flip), giving a realistic noise-floor
# for the identity gate (typically 0.82-0.90 for the same person).
# This is more conservative than the hardcoded fallback (0.65) in
# arcface-client.ts but still safe.
#
# Port: 8184. Set POPPY_ARCFACE_URL=http://<box-ip>:8184 in the backend.
# NOT public-internet accessible: SG inbound from backend SG only.
#
# Required env vars (same as training-api):
#   S3_BUCKET   - bucket holding the S3-keyed images
#   AWS_REGION  - bucket region
# IAM: s3:GetObject on arn:aws:s3:::<S3_BUCKET>/* (read images + upload checkpoints)
# ============================================================
mkdir -p "$ROOT/arcface-api"
cat >"$ROOT/arcface-api/server.py" <<'ARCPYEOF'
#!/usr/bin/env python3
"""
ArcFace scoring service for poppy-lora-training box.

Listens on :8184. Downloads S3-keyed images, extracts ArcFace embeddings
via InsightFace (antelopev2 pack), and returns cosine similarity.

Contract (matches arcface-client.ts exactly):
  POST /score    { ref_key, candidate_key }  -> { similarity: float }
  POST /baseline { ref_key }                 -> { score: float }
  GET  /health                               -> { ok: true }
"""
import io
import json
import os
import numpy as np
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from PIL import Image  # type: ignore

# Lazy-initialised InsightFace app (loaded once on first request).
_app = None
_app_lock = __import__("threading").Lock()

INSIGHTFACE_ROOT = Path("/opt/poppy/models/comfyui/insightface")
S3_BUCKET = os.environ.get("S3_BUCKET", "")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")


def _get_app():
    global _app
    if _app is not None:
        return _app
    with _app_lock:
        if _app is not None:
            return _app
        import insightface  # type: ignore
        app = insightface.app.FaceAnalysis(
            name="antelopev2",
            root=str(INSIGHTFACE_ROOT),
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        app.prepare(ctx_id=0, det_size=(640, 640))
        _app = app
        return _app


def _download_s3(key: str) -> bytes:
    import boto3  # type: ignore
    s3 = boto3.client("s3", region_name=AWS_REGION)
    buf = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, key, buf)
    return buf.getvalue()


def _get_embedding(image_bytes: bytes) -> np.ndarray:
    """Return the normalised 512-dim ArcFace embedding for the largest face in the image."""
    app = _get_app()
    img = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    faces = app.get(img)
    if not faces:
        raise ValueError("no face detected in image")
    # Pick the largest face by bounding-box area.
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    emb = face.normed_embedding  # already L2-normalised by InsightFace
    return emb


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    # Both embeddings are pre-normalised; dot product IS cosine similarity.
    return float(np.clip(float(np.dot(a, b)), 0.0, 1.0))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def _send_json(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/score":
            try:
                body = self._read_body()
                ref_key = body.get("ref_key", "")
                candidate_key = body.get("candidate_key", "")
                if not ref_key or not candidate_key:
                    self._send_json(400, {"error": "ref_key and candidate_key required"})
                    return
                ref_emb = _get_embedding(_download_s3(ref_key))
                cand_emb = _get_embedding(_download_s3(candidate_key))
                similarity = _cosine(ref_emb, cand_emb)
                self._send_json(200, {"similarity": similarity})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if self.path == "/baseline":
            try:
                body = self._read_body()
                ref_key = body.get("ref_key", "")
                if not ref_key:
                    self._send_json(400, {"error": "ref_key required"})
                    return
                ref_bytes = _download_s3(ref_key)
                emb_orig = _get_embedding(ref_bytes)
                # Horizontal flip of the same image gives a realistic intra-identity
                # noise floor (same person, slightly different pose/crop).
                img_flipped = np.array(Image.open(io.BytesIO(ref_bytes)).convert("RGB"))[:, ::-1, :]
                img_flipped_bytes = io.BytesIO()
                Image.fromarray(img_flipped).save(img_flipped_bytes, format="PNG")
                emb_flip = _get_embedding(img_flipped_bytes.getvalue())
                score = _cosine(emb_orig, emb_flip)
                self._send_json(200, {"score": score})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        self._send_json(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(os.environ.get("ARCFACE_API_PORT", "8184"))
    print(f"arcface-api listening on :{port}", flush=True)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
ARCPYEOF
chmod +x "$ROOT/arcface-api/server.py"

# ============================================================
# Caption / WD14 tagger service (HTTP :8185)
#
# Satisfies the contract expected by caption-client.ts:
#   POST /caption  { image_key: string }
#                  -> { caption: string }   (kohya-style tag string)
#
# Model choice: WD14 tagger (SmilingWolf/wd-v1-4-convnextv2-tagger-v2
# from HuggingFace) rather than a full VLM (LLaVA/CogVLM). Rationale:
#   - WD14 produces "comma-separated booru tag" captions that are the
#     standard format for kohya LoRA training datasets.
#   - The inference cost is negligible (~20ms/image on GPU vs 5-30s for a VLM).
#   - Full VLMs like LLaVA-7B would require an additional 14GB of VRAM on a box
#     whose VRAM budget is already 14-16GB for kohya training.
#   - kohya prepends the trigger token before training; the tagger output is
#     appended after the trigger token (caller does this in dataset.ts).
#
# The service downloads the tagger model from HuggingFace on first request
# (cached to /opt/poppy/caption-model/). Model size: ~600MB (onnx weights).
#
# Port: 8185. Set POPPY_CAPTION_URL=http://<box-ip>:8185 in the backend.
# NOT public-internet accessible: SG inbound from backend SG only.
#
# Required env vars:
#   S3_BUCKET   - bucket holding the S3-keyed images to caption
#   AWS_REGION  - bucket region
# IAM: s3:GetObject on arn:aws:s3:::<S3_BUCKET>/* (read images to caption)
# ============================================================
mkdir -p "$ROOT/caption-api"
cat >"$ROOT/caption-api/server.py" <<'CAPPYEOF'
#!/usr/bin/env python3
"""
WD14 tagger captioning service for poppy-lora-training box.

Listens on :8185. Downloads an S3-keyed image, runs the WD14 tagger
(SmilingWolf/wd-v1-4-convnextv2-tagger-v2), and returns a kohya-style
comma-separated tag string.

Contract (matches caption-client.ts exactly):
  POST /caption  { image_key: string }  -> { caption: string }
  GET  /health                          -> { ok: true }

Model choice: WD14 onnx tagger over a full VLM. The VRAM budget on this
box is nearly exhausted by kohya training; a tagger uses ~0GB VRAM (onnx
CPU inference, ~20ms/image). kohya-style comma-separated tags are the
correct format for SDXL LoRA training captions.
"""
import io
import json
import os
import numpy as np
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from PIL import Image  # type: ignore

S3_BUCKET = os.environ.get("S3_BUCKET", "")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")
MODEL_DIR = Path("/opt/poppy/caption-model")
# HuggingFace repo ID for the WD14 onnx tagger.
HF_MODEL_ID = "SmilingWolf/wd-v1-4-convnextv2-tagger-v2"
# Confidence threshold: only tags above this score are included in the caption.
# 0.35 is the standard threshold for WD14 in kohya workflows.
THRESHOLD = float(os.environ.get("WD14_THRESHOLD", "0.35"))

_tagger_state: dict = {}
_tagger_lock = __import__("threading").Lock()


def _get_tagger():
    """Return (session, tags_list) lazily loaded on first call."""
    if _tagger_state.get("ready"):
        return _tagger_state["session"], _tagger_state["tags"]
    with _tagger_lock:
        if _tagger_state.get("ready"):
            return _tagger_state["session"], _tagger_state["tags"]
        import onnxruntime as ort  # type: ignore
        from huggingface_hub import hf_hub_download  # type: ignore
        import csv

        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        model_path = hf_hub_download(
            repo_id=HF_MODEL_ID,
            filename="model.onnx",
            cache_dir=str(MODEL_DIR),
        )
        tags_path = hf_hub_download(
            repo_id=HF_MODEL_ID,
            filename="selected_tags.csv",
            cache_dir=str(MODEL_DIR),
        )
        # Load tag names from CSV (column "name").
        tags = []
        with open(tags_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tags.append(row["name"])

        session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],  # CPU: avoids VRAM contention with kohya
        )
        _tagger_state["session"] = session
        _tagger_state["tags"] = tags
        _tagger_state["ready"] = True
        return session, tags


def _preprocess(image_bytes: bytes, target_size: int = 448) -> np.ndarray:
    """Resize + center-crop to square, normalize to [-1,1] float32 NCHW."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    # Pad to square first, then resize.
    w, h = img.size
    max_side = max(w, h)
    pad = Image.new("RGB", (max_side, max_side), (255, 255, 255))
    pad.paste(img, ((max_side - w) // 2, (max_side - h) // 2))
    pad = pad.resize((target_size, target_size), Image.BICUBIC)
    arr = np.array(pad, dtype=np.float32) / 255.0
    # WD14 expects BGR channel order (trained on OpenCV BGR).
    arr = arr[:, :, ::-1]
    # HWC -> NHWC (model expects batch dim).
    return arr[np.newaxis]


def _caption_image(image_bytes: bytes) -> str:
    session, tags = _get_tagger()
    img_arr = _preprocess(image_bytes)
    input_name = session.get_inputs()[0].name
    preds = session.run(None, {input_name: img_arr})[0][0]  # shape (num_tags,)
    # Filter by threshold; skip the first 4 tags which are rating tags (not content).
    selected = [
        tags[i]
        for i in range(4, len(tags))
        if i < len(preds) and float(preds[i]) >= THRESHOLD
    ]
    return ", ".join(selected)


def _download_s3(key: str) -> bytes:
    import boto3  # type: ignore
    s3 = boto3.client("s3", region_name=AWS_REGION)
    buf = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, key, buf)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def _send_json(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/caption":
            try:
                body = self._read_body()
                image_key = body.get("image_key", "")
                if not image_key:
                    self._send_json(400, {"error": "image_key required"})
                    return
                image_bytes = _download_s3(image_key)
                caption = _caption_image(image_bytes)
                if not caption.strip():
                    self._send_json(500, {"error": "tagger produced empty caption"})
                    return
                self._send_json(200, {"caption": caption})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        self._send_json(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(os.environ.get("CAPTION_API_PORT", "8185"))
    print(f"caption-api listening on :{port}", flush=True)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
CAPPYEOF
chmod +x "$ROOT/caption-api/server.py"

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
# S3_BUCKET and AWS_REGION are injected by deploy.sh via EnvironmentFile
# or set directly here if the instance profile covers the role (preferred).
EnvironmentFile=-/opt/poppy/env.conf
ExecStart=/opt/poppy/kohya_ss/venv/bin/python /opt/poppy/training-api/server.py
WorkingDirectory=/opt/poppy/training-api
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-lora-training-api.service || echo "!! training-api unit file is empty"

# ============================================================
# ArcFace scoring service systemd unit (:8184)
# ============================================================
cat >/etc/systemd/system/poppy-lora-arcface-api.service <<UNIT
[Unit]
Description=poppy LoRA ArcFace scoring API :8184
After=network.target
[Service]
Restart=always
RestartSec=5
Environment="ARCFACE_API_PORT=8184"
EnvironmentFile=-/opt/poppy/env.conf
ExecStart=/opt/poppy/kohya_ss/venv/bin/python /opt/poppy/arcface-api/server.py
WorkingDirectory=/opt/poppy/arcface-api
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-lora-arcface-api.service || echo "!! arcface-api unit file is empty"

# ============================================================
# Caption / WD14 tagger service systemd unit (:8185)
# ============================================================
cat >/etc/systemd/system/poppy-lora-caption-api.service <<UNIT
[Unit]
Description=poppy LoRA WD14 caption API :8185
After=network.target
[Service]
Restart=always
RestartSec=5
Environment="CAPTION_API_PORT=8185"
# WD14_THRESHOLD defaults to 0.35; override here to tune tag density.
Environment="WD14_THRESHOLD=0.35"
EnvironmentFile=-/opt/poppy/env.conf
ExecStart=/opt/poppy/kohya_ss/venv/bin/python /opt/poppy/caption-api/server.py
WorkingDirectory=/opt/poppy/caption-api
[Install]
WantedBy=multi-user.target
UNIT
test -s /etc/systemd/system/poppy-lora-caption-api.service || echo "!! caption-api unit file is empty"

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

# Open connections on training API (:8282), ComfyUI (:8188), arcface-api (:8184), or caption-api (:8185)?
conns=$(ss -Htn state established '( sport = :8282 or sport = :8188 or sport = :8184 or sport = :8185 )' 2>/dev/null | wc -l | tr -d ' ')

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
systemctl enable --now poppy-lora-arcface-api.service
systemctl enable --now poppy-lora-caption-api.service
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

# Wait for ArcFace scoring API to answer.
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8184/health >/dev/null 2>&1; then
    echo "arcface-api up"; break
  fi
  sleep 5
done

# Wait for caption/WD14 tagger API to answer.
# Note: first request triggers model download from HuggingFace (~600MB).
# This wait only checks that the HTTP server is up; the model loads lazily.
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8185/health >/dev/null 2>&1; then
    echo "caption-api up"; break
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
