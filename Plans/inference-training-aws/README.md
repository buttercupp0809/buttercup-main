# poppy-lora-training - ephemeral per-character LoRA training box on AWS

> **DO NOT PROVISION OR RUN WITHOUT EXPLICIT HUMAN APPROVAL.**
> These scripts create billable AWS resources when executed.
> Per repo guardrails (CLAUDE.md), every AWS provisioning action requires
> a fresh, per-action approval. Do not run `deploy.sh` or any AWS CLI
> commands in this directory without asking first.

A dedicated, scale-to-zero GPU box for per-character SDXL LoRA training.
Completely separate from the inference boxes (`Plans/inference-aws/`,
`Plans/inference-video-aws/`): its own instance, tagged `Project=poppy-lora-training`.
It starts on-enqueue (when a job lands on the `buttercupp-lora` BullMQ queue)
and stops on-idle (after `IDLE_MINUTES` of inactivity and an empty queue).

## Why a separate box

- Training (kohya_ss SDXL LoRA) and inference (ComfyUI generation) have
  opposite load profiles. Training is a long batch job (15-30 min); inference
  is short-lived and latency-sensitive. Sharing a box would force always-on
  billing or cold-start delays on the critical inference path.
- Training jobs are rare (one per character, at most a handful/day), so a
  scale-to-zero box with a few minutes of warm-up is acceptable.

## Instance

| Field | Value |
|-------|-------|
| Type | `g5.xlarge` (A10G 24GB VRAM, 16GB RAM) |
| Region | `eu-north-1` (Stockholm, same as inference boxes) |
| AMI | DLAMI base OSS NVIDIA driver, Ubuntu 22.04 (docker + nvidia-container-toolkit preinstalled) resolved via SSM at deploy time |
| EBS | 200GB gp3, `DeleteOnTermination=true` |
| Shutdown behavior | `stop` (not terminate) - EBS persists across stop/start |

**VRAM budget for SDXL LoRA training (rank 32, bf16):**
- Model weights in VRAM: ~8GB (SDXL UNet + text encoders)
- Gradient state + optimizer: ~4GB
- Activations at batch=1: ~2GB
- Total peak: ~14-16GB. Fits comfortably on 24GB (A10G / g5.xlarge).
- Swap: 24GB swapfile absorbs transient host-RAM spikes during safetensors mmap.

Alternative if g5.xlarge has insufficient capacity: `g6.xlarge` (L4 24GB,
same VRAM, slower than A10G for bf16 mixed precision but sufficient).
Set `FORCE_AZ` in `config.sh` to pin a different AZ when one AZ is out of
stock (InsufficientInstanceCapacity).

## Models baked into the AMI (via `user-data.sh`)

| Model | Path on box | Used by |
|-------|-------------|---------|
| `realvisxlV50.safetensors` | `/opt/poppy/models/comfyui/checkpoints/` | Validation image generation (ComfyUI) |
| `juggernautXL_v9.safetensors` | `/opt/poppy/models/comfyui/checkpoints/` | Fallback base-model validation |
| `4x-UltraSharp.pth` (upscaler) | `/opt/poppy/models/comfyui/upscale_models/` | Validation upscale pass |
| `scrfd_10g_bnkps.onnx` + `glintr100.onnx` + siblings (antelopev2 face pack) | `/opt/poppy/models/comfyui/insightface/models/antelopev2/` | ArcFace scoring in dataset prep and checkpoint validation |
| `buffalo_l` InsightFace pack | `/opt/poppy/models/comfyui/insightface/models/buffalo_l/` | ArcFace scorer (BoxArcfaceScorer, Task 8/11) |

`realvisxlV50.safetensors` is the canonical checkpoint filename referenced by
`REALVISXL_CHECKPOINT` in `backend/src/media/handlers/image.ts` and by Task 7's
`resolveCheckpointForBaseModel("realvisxl_v5")`. It must be present on the box.

## Cost model (hard cap = $400/mo)

- `g5.xlarge` in `eu-north-1` ~ $1.006/hr (on-demand, 2026 pricing).
- Stopped = only ~$16/mo EBS storage (200GB gp3 at ~$0.08/GB).
- At 3 training runs/day x 30 min each = ~1.5 hr/day compute = ~$45/mo. Well
  under cap.
- Monthly budget alarm at `$MONTHLY_BUDGET_USD` (default $400) sends email
  at 80% and 100%. Recommended: also set an AWS Budgets stop-instance action
  at 90% as a belt-and-braces backstop (manual step; see inference-aws README).

## Scale-to-zero behavior (queue router)

See `train-box-router.md` for the full start-on-enqueue / stop-on-idle spec.

Briefly:
- **Start trigger:** when the BullMQ worker (backend) picks up a job from the
  `buttercupp-lora` queue and finds the box stopped, it calls the router
  `/wake` endpoint. The box starts; the worker polls `/status` until
  `ready`, then sends the training payload.
- **Idle stop:** on-box `poppy-lora-idle` timer checks every 5 min. If no
  GPU activity, no open connections on `:8282` (training API), and the
  `buttercupp-lora` queue is empty for `IDLE_MINUTES` consecutive ticks, the
  box calls `shutdown -h now` (STOP behavior, not terminate).
- **No Elastic IP** - avoids idle-IP charges. The router always prints the
  current IP after a start. The backend reads it from the router `/status`
  response.

## Services on the training box

Five HTTP services run on the training box. All are started by systemd on boot
and are NOT accessible from the public internet (backend SG inbound only).

| Service | Port | Env var (backend) | Description |
|---|---|---|---|
| training-api | 8282 | `POPPY_TRAINING_URL` | POST /train + GET /status/:jobId (kohya runner + checkpoint S3 upload) |
| arcface-api | 8184 | `POPPY_ARCFACE_URL` | POST /score + POST /baseline (InsightFace ArcFace cosine similarity) |
| caption-api | 8185 | `POPPY_CAPTION_URL` | POST /caption (WD14 tagger, kohya-style comma-separated tags) |
| ComfyUI | 8188 | (internal, validation only) | Validation image generation |
| idle-check | (timer) | n/a | Auto-stop: shuts box after IDLE_MINUTES of inactivity |

### training-api contract (port 8282)

```
POST /train    { jobId: string, tomlConfig: string }
               -> { ok: true, jobId: string }
GET  /status/:jobId
               -> { state: "running"|"done"|"failed"|"unknown",
                    jobId: string,
                    checkpoints: [ { step: number, key: string } ],
                    log: string }
GET  /health   -> { ok: true }
```

After kohya finishes, `server.py` uploads all `*.safetensors` files from the
TOML `output_dir` to S3 under `lora/<outputName>/<jobId>/step-<NNNNNN>.safetensors`
and populates the `checkpoints` array in subsequent `/status` responses.
The `key` values are exactly what `training-client.ts#collectCheckpoints` expects.

Required box env (set via `/opt/poppy/env.conf` or EC2 instance profile):
- `S3_BUCKET` (= `POPPY_S3_BUCKET_GENERATED` on the backend side)
- `AWS_REGION`

### arcface-api contract (port 8184)

```
POST /score    { ref_key: string, candidate_key: string }
               -> { similarity: number }   (cosine similarity [0..1])
POST /baseline { ref_key: string }
               -> { score: number }        (intra-identity noise floor)
GET  /health   -> { ok: true }
```

Both `ref_key` and `candidate_key` are S3 keys. The service downloads the images,
extracts the 512-dim ArcFace embedding via InsightFace (`antelopev2` pack baked
into EBS), and returns cosine similarity. `/baseline` computes a horizontal-flip
self-comparison to estimate the intra-identity noise floor (typically 0.82-0.90).

Model: `antelopev2` (scrfd_10g_bnkps.onnx + glintr100.onnx + siblings), already
baked to `/opt/poppy/models/comfyui/insightface/models/antelopev2/` by `user-data.sh`.

Required box env: `S3_BUCKET`, `AWS_REGION`.

### caption-api contract (port 8185)

```
POST /caption  { image_key: string }
               -> { caption: string }   (comma-separated kohya-style tags)
GET  /health   -> { ok: true }
```

`image_key` is an S3 key. The service downloads the image and runs the WD14
tagger (`SmilingWolf/wd-v1-4-convnextv2-tagger-v2`), returning comma-separated
booru tags above the 0.35 confidence threshold. This is the standard caption
format for kohya LoRA training datasets.

Model choice rationale: WD14 tagger over a full VLM (LLaVA/CogVLM). The VRAM
budget is nearly exhausted by kohya training (~14-16GB of 24GB). WD14 runs on
CPU via ONNX (~20ms/image, 0 VRAM) and produces kohya-native tag format directly.
Full VLMs would require 14GB+ additional VRAM and much longer inference.

The model is downloaded on first request from HuggingFace (~600MB onnx) and
cached to `/opt/poppy/caption-model/`.

Required box env: `S3_BUCKET`, `AWS_REGION`.

### env.conf file

`deploy.sh` should write `/opt/poppy/env.conf` (sourced by all three EnvironmentFile=
entries) with at minimum:

```
S3_BUCKET=<value of POPPY_S3_BUCKET_GENERATED from the backend>
AWS_REGION=eu-north-1
```

If the instance has an IAM instance profile with the required S3 permissions,
the AWS SDK resolves credentials automatically; the `env.conf` only needs the
bucket name and region.

## Network / IAM / SG

- **Reuses** the VPC, route table, and SG from `Plans/inference-aws/`. No new
  VPC needed.
- **New subnet** in a g5-capable AZ (e.g. `eu-north-1b`; set `AZ` in
  `config.sh`). If that AZ has insufficient capacity, set `FORCE_AZ` to try
  `eu-north-1a` or `eu-north-1c`.
- SG inbound: port 22 (SSH, owner IP only); ports 8282, 8184, 8185 (training
  API, arcface-api, caption-api - backend SG inbound only, not public internet).
- IAM (instance profile - required): `s3:PutObject` on
  `arn:aws:s3:::<S3_BUCKET>/lora/*` (checkpoint upload by training-api) and
  `s3:GetObject` on `arn:aws:s3:::<S3_BUCKET>/*` (image reads by arcface-api
  and caption-api). The same instance profile covers all three services.
- Lambda router IAM: scoped to `ec2:StartInstances` + `ec2:StopInstances` on
  this instance ARN only (matches inference-aws router pattern).

### ArcFace on training box vs image box

The image box (`Plans/inference-aws/`) already runs InsightFace for InstantID.
Hosting ArcFace scoring there would avoid a separate service, but it would:
1. Create a cross-box dependency (training jobs need image box up).
2. Add latency and SG complexity (training box calls image box for every score).
3. Risk interference with concurrent inference traffic.

The training box already has the `antelopev2` models baked in (they are used by
InsightFace within ComfyUI validation workflows). The arcface-api service reuses
these same models at no extra cost. `POPPY_ARCFACE_URL` points at the training box.

If future VRAM pressure on the training box makes this untenable, the
arcface-api script is self-contained and can be moved to the image box with
no changes to `arcface-client.ts`.

## Commands

```bash
cd Plans/inference-training-aws

# APPROVAL REQUIRED before running any of these.
./deploy.sh     # ONE-TIME: create subnet + launch instance + budget (BILLABLE)
./start.sh      # start box, refresh SG to your IP, wait for training API
./stop.sh       # stop box (halts compute billing; models on EBS survive)
./status.sh     # instance state + IP + month-to-date cost (read-only, free)
./destroy.sh    # remove all resources created by deploy.sh (type DESTROY)
```

## Before you deploy

Edit `config.sh` (not yet written; mirror `inference-video-aws/config.sh`):
- `REALVISXL_MODEL_URL` - direct HuggingFace download for `realvisxlV50.safetensors`
  (requires HF token; SG API access required).
- `JUGGERNAUT_MODEL_URL` - optional; enables juggernaut-base validation.
- `HF_TOKEN` - for gated HF model downloads.
- `ALERT_EMAIL` - for budget alarm emails.
- `FORCE_AZ` - override AZ if `eu-north-1b` is out of g5 capacity.

## Reference

Conventions (colors, state, tagging, logging, cost reporting) mirror
`Plans/inference-aws/` and `Plans/inference-video-aws/`.
Queue name `buttercupp-lora` matches `LORA_QUEUE_NAME` in
`packages/shared/src/lora.ts`.
