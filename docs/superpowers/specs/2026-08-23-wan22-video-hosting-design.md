# Wan 2.2 A14B Video Generation Hosting - Design

Date: 2026-08-23
Status: Draft for review
Track: B (of two). Independent of the image-quality track. Shares no runtime state
with the existing GPU box.

## Goal

Add self-hosted AI video generation (Wan 2.2 A14B) to the platform: both
image-to-video (I2V) and text-to-video (T2V), 5s clips, delivered async via the
existing BullMQ media queue, results uploaded to S3 and shown as reels /
in-chat media. Host on a NEW, dedicated GPU instance so the known-good
Stheno + Juggernaut A10G box is never touched.

## Decisions (locked with user)

- Model: Wan 2.2 A14B (MoE, two 14B experts: high-noise + low-noise), fp8_scaled.
- Modes: BOTH I2V and T2V from day one.
- Speed: LightX2V Lightning LoRAs are the production DEFAULT (4-8 steps, cfg 1.0,
  ~1 min/clip), with a full-step "hero" path behind a flag (20-40 steps, best
  quality, 8-15 min/720p clip).
- Instance: dedicated `g6e.xlarge` (1x L40S, 45GB, ~$1.86/hr on-demand,
  available eu-north-1). A14B fp8 fits comfortably at 480p and 720p. The current
  24GB A10G cannot run A14B and does not accelerate fp8; do NOT co-locate.
- Hosting mode: scale-to-zero (start-on-enqueue, stop-on-idle) to control cost.

## Why a separate box (not resizing the existing one)

The A10G box is flagged known-good / do-not-touch (login, chat, image gen all
depend on it). A14B needs ~40GB+ for 720p fp8, which the A10G cannot provide, and
fp8 is not accelerated on A10G. Resizing risks the working Stheno/Juggernaut
services and forces VRAM contention. A dedicated g6e box isolates the new
subsystem and lets the expensive GPU be stopped when no video jobs are queued.

## Model + workflow (ComfyUI native)

Wan 2.2 has native ComfyUI support (no custom node for the base model). Files
under `ComfyUI/models/`:
- diffusion_models: `wan2.2_{t2v,i2v}_high_noise_14B_fp8_scaled.safetensors` +
  `..._low_noise_14B_fp8_scaled.safetensors` (both experts, both tasks).
- vae: `wan_2.1_vae.safetensors` (A14B reuses the 2.1 VAE).
- text_encoders: `umt5_xxl_fp8_e4m3fn_scaled.safetensors`.
- loras: LightX2V / Wan2.2-Lightning high-noise + low-noise distill LoRAs.
- All from `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (and lightx2v HF for LoRAs).

Two-expert sampling: high-noise expert denoises early steps, hands the latent to
the low-noise expert for late steps (two `KSamplerAdvanced` split by
start/end step). With Lightning LoRAs: apply high LoRA to high expert, low LoRA to
low expert; total steps 4-8, cfg 1.0.

Generation params: 16 fps native, 81 frames = ~5s (frame counts follow 4n+1),
480p (832x480) default / 720p (1280x720) premium. Negative prompt = existing 18+
`SAFETY_NEGATIVE`.

Cold-start budget: EC2 boot + Docker + ComfyUI ~60-120s; model load (two 14GB
experts + encoder + VAE) is the dominant term. A pre-warm script loads both
experts into VRAM on boot. Realistic first-clip latency after a cold box:
~2-4 min before generation starts. Acceptable for async UX.

## Architecture

### 1. Video GPU stack (new, mirrors inference-aws)
New directory `Plans/inference-video-aws/` cloning the `inference-aws` numbered-
script pattern (config.sh, 10-deploy, 20-start, 30-stop, router lambda,
user-data.sh, destroy). Isolated: own VPC, security group, tags, budget.
- `config.sh`: INSTANCE_TYPE=g6e.xlarge, region eu-north-1, EBS large enough for
  ~30GB of weights + Docker (>=200GB gp3), ComfyUI on :8188, Wan model + LoRA
  download URLs, its own router token, its own budget alarm.
- `user-data.sh`: install ComfyUI (Docker), download Wan models + Lightning LoRAs
  to a persistent EBS volume (or bake into AMI so cold starts do not re-download
  ~30GB), systemd unit for ComfyUI, pre-warm hook.
- Router lambda: /wake, /status, /sleep + idle auto-stop (10-15 min) - same
  scale-to-zero pattern as the image box, tuned for bursty video load.
- Guard: an On-Demand Capacity Reservation (or a fallback AZ/region) since g6e
  can hit InsufficientInstanceCapacity on cold restart.

### 2. Backend - self-hosted Wan provider
- New `backend/src/inference/videoEndpoint.ts` mirroring `poppyEndpoint.ts`:
  resolves the video box base URL via static override
  (`POPPY_WAN_URL`) or its router (`POPPY_VIDEO_ROUTER_URL` + token), with
  wake/poll/cache. Separate from the image box resolver.
- Extend `backend/src/media/video/providers.ts`: add `generateWithComfyWan()`
  (I2V and T2V) mirroring the image `generateWithComfyUI` pattern (POST /prompt,
  poll /history, download /view). Insert it as the PRIMARY attempt in
  `generateVideo()`, ahead of the existing Fal -> Replicate fallback. Fal/Replicate
  stay as cloud fallback when the box is unavailable.
- New `backend/src/media/video/workflow.ts`: build the Wan two-expert ComfyUI
  graph (T2V and I2V variants; Lightning vs full-step toggle).
- `backend/src/media/video/constants.ts`: replace placeholders. Set fps=16 (Wan
  native, currently 24 - must fix), frame counts on the 4n+1 grid, 480p default /
  720p premium sizes, step/cfg presets for Lightning vs full-step.

### 3. Queue + request flow
- Video worker handler: add `handlers/video.ts` (mirror `handlers/image.ts`) and
  register `kind === "video"` in `backend/src/queue/media-worker.ts`. Reuse the
  same debit/quota/dual-write/notify lifecycle. Lower concurrency (1-2) given a
  single video GPU and long jobs; own rate limiter.
- Scale-to-zero trigger: on video enqueue, backend calls the video router /wake
  (start-on-enqueue). Box idle-stops itself.
- I2V reference: use the character's existing consistent image (from
  CharacterMedia) as the I2V input frame, so the clip inherits the image
  consistency lock. T2V uses prompt only.
- Chat + create intent: add video-request intent detection (mirroring image
  intent in `backend/src/chat/intent.ts`) so users can request a clip in chat;
  and/or a create-flow entry point. Detection is additive to existing image intent.

### 4. Storage + delivery (reuse existing)
- Videos -> `reels/` prefix -> `POPPY_S3_BUCKET_REELS` (already wired in
  `backend/src/media/storage.ts`). CloudFront/S3 presign as today.
- `MediaAsset` (queued->processing->ready/failed) + dual-write to `CharacterMedia`
  with `kind="video"` (schema already supports both).

## Components and boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `Plans/inference-video-aws/*` | Provision + start/stop the g6e video box | AWS CLI, ComfyUI, Wan weights |
| `videoEndpoint.ts` | Resolve/wake the video box URL | video router |
| `video/workflow.ts` | Build Wan T2V/I2V ComfyUI graph | constants |
| `video/providers.ts` | Provider chain: Wan (self-host) -> Fal -> Replicate | videoEndpoint, workflow |
| `handlers/video.ts` | Queue job: prompt build, generate, upload, dual-write | providers, storage, asset |
| chat/create intent | Detect a video request, enqueue job | queue |

## Licensing + safety

- Wan 2.2 base weights: Apache 2.0 - clean for commercial use.
- Base model is uncensored (no content filter) but has limited explicit fidelity.
  A community NSFW LoRA is a possible Phase 2, subject to a per-LoRA license audit
  (some fine-tunes are non-commercial). Out of scope for the initial build.
- Mandatory 18+ `SAFETY_NEGATIVE` applied to every generation, same as images.

## Testing

- Box bring-up test (approval-gated AWS action): provision g6e, confirm ComfyUI
  responds on :8188, run one T2V and one I2V clip end to end, verify the mp4
  uploads to S3 and plays. This is the user's explicit "we have to test it".
- Lightning vs full-step comparison: same prompt/seed, measure clip time and
  subjective quality; confirm Lightning default is acceptable.
- Backend unit tests: provider chain selection (Wan primary, Fal/Replicate
  fallback), workflow builder graph shape (T2V vs I2V, Lightning vs full-step),
  fps/frame-count math on the 4n+1 grid. No GPU needed.
- Queue integration test: enqueue video job against a mocked ComfyUI, assert the
  MediaAsset lifecycle + CharacterMedia dual-write + quota debit.

## Cost

- g6e.xlarge ~$1.86/hr. Scale-to-zero keeps it near $0 when idle (only EBS ~$20/mo
  for ~200GB gp3). Budget alarm mirrors the image box ($/mo cap + auto-stop
  backstop). Keep-warm 10-15 min during peak to avoid repeated cold starts.

## Rollout phases

1. Provision video box + load Wan A14B fp8 + Lightning LoRAs; verify ComfyUI (AWS,
   approval-gated).
2. Backend: videoEndpoint + Wan provider + workflow builder + constants fix; unit
   tests. (Local, no deploy.)
3. Queue: video handler + intent detection; integration tests. (Local.)
4. End-to-end test: one I2V + one T2V clip through the real box to S3.
5. Wire chat/create UX + scale-to-zero triggers; enable behind a flag.
6. (Later) NSFW LoRA after license audit; 720p premium tier; T2V polish.

## Out of scope

- Image-quality track (separate spec).
- The 5B TI2V cheap tier (documented as a possible future budget path; not built).
- Long-form (>10s) video, audio, lipsync.
