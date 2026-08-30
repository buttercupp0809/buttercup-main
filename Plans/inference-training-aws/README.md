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

## Network / IAM / SG

- **Reuses** the VPC, route table, and SG from `Plans/inference-aws/`. No new
  VPC needed.
- **New subnet** in a g5-capable AZ (e.g. `eu-north-1b`; set `AZ` in
  `config.sh`). If that AZ has insufficient capacity, set `FORCE_AZ` to try
  `eu-north-1a` or `eu-north-1c`.
- SG inbound: port 22 (SSH, owner IP only) and port 8282 (training API, backend
  SG only - not public internet).
- IAM: no instance profile needed for training itself. S3 uploads for
  checkpoint artifacts use presigned URLs generated by the backend.
- Lambda router IAM: scoped to `ec2:StartInstances` + `ec2:StopInstances` on
  this instance ARN only (matches inference-aws router pattern).

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
