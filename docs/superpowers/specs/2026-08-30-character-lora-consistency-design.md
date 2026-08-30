# Character LoRA Consistency (per-character identity lock) - Design

Date: 2026-08-30
Status: Draft for review
Track: A (extends `2026-08-23-image-quality-refinement-design.md`). All-SDXL.
Does not touch the Wan 2.2 video track.

## Goal

Reach Candy-AI-V2-class character consistency: the same face reproduced exactly
across many poses and expressions (smiling, side profile, sad, happy, seductive),
with correct hands and body anatomy. The chosen lever is a trained per-character
LoRA on an SDXL photoreal base, finished with the detailer/upscale tail already
designed in the 2026-08-23 track.

Two user-reported problems this targets:

1. Face features not copied exactly across generations (identity drift).
2. Distorted hands and fingers.

Plus explicit control over pose and expression while identity stays locked.

## Decisions locked (from brainstorming, 2026-08-30)

- Identity method: per-character SDXL LoRA (fidelity ceiling), not adapters alone.
- Base model: all-SDXL. RealVisXL for LoRA-enabled characters (photoreal upgrade,
  commercially licensable, strong native NSFW); Juggernaut XL v9 stays default for
  the long tail. FLUX ruled out: FLUX.1-dev is non-commercial and NSFW-weak;
  InfiniteYou weights are CC-BY-NC. All disqualified for a commercial adult product.
- Training compute: a dedicated ephemeral scale-to-zero GPU box (reuses the Wan
  video-box pattern), so training never competes with the live inference box
  (which has a known 16GB system-RAM ceiling and serves Stheno + Juggernaut).
- Scope: flagship-first. Train the top ~10-20 most-used system personas; the rest
  and all user-created characters stay on the current InstantID adapter path.
- Trigger: admin / on-demand (internal action or script), not auto-at-creation.

## What must not break (inherited invariants)

From the 2026-08-23 track and repo rules:

- The InstantID + inswapper + GPEN identity lock stays the path for any character
  without a `ready` LoRA. Byte-identical when all new flags are off.
- The numeric "do not disturb" gate: no change ships that lowers mean ArcFace
  cosine similarity (reference vs generated face) versus the current chain.
- Prisma singleton only (`import { prisma } from "@buttercupp/database"`).
- Strict TS, zod at every trust boundary, no em dash, backend compiles to CJS.
- Fallback-friendly: a missing ComfyUI node or model degrades to the current
  graph and logs; it never fails the job.

## Current pipeline (touch points)

- `backend/src/media/image/workflow/` - composable, flag-gated node-group blocks
  (base, instantid, faceswap, facedetailer, handdetailer, pose-controlnet, pulid)
  assembled by `assemble.ts`. Node numbering convention already established.
- `backend/src/media/image/providers.ts` - `generateWithComfyUIConsistent()`.
- `backend/src/media/image/prompt.ts` + `prompt-fills.ts` - positive/negative build.
- `backend/src/media/handlers/image.ts` - worker image handler.
- `backend/src/media/reference.ts` - reference-image resolution.
- `backend/src/queue/` - BullMQ media queue + worker.
- `packages/database/prisma/schema.prisma` - `AppearanceSheet.loraRef String?`
  already exists and is currently unused. `CharacterMedia`, `CharacterVersion`.
- `packages/shared/src/media.ts` - media job + payload zod schemas.
- `Plans/inference-aws/` - live image box scripts. New:
  `Plans/inference-training-aws/` for the ephemeral training box.

## Architecture: two subsystems

### Subsystem A - LoRA training pipeline (new)

Five stages, orchestrated by an admin-triggered `train-lora` job that runs on the
ephemeral training box and writes state to a new `CharacterLora` row.

1. Dataset builder. For a target character, assemble 20-50 images:
   - Pull existing `ready` `CharacterMedia` images for the character.
   - Generate a targeted turntable on the LIVE image box using the current
     InstantID + faceswap pipeline: fixed identity, varied yaw (front, three-quarter
     L+R, profile), varied expression (neutral, smile, etc.), and a ~0.33
     face-crop-to-full-body ratio so face and body stay separable in training.
   - Auto-curate: drop images whose ArcFace cosine to the primary reference is below
     a threshold (off-identity outliers) or that fail a blur/quality check. Optional
     admin approval of the final sheet. Write a dataset manifest to S3.
2. Captioner. Auto-caption each image (WD14 / BLIP or a VLM) in kohya SDXL style:
   a synthetic per-character trigger token (e.g. `ch_<shortid>`, never the display
   name) carries identity; captions describe pose, framing, background, expression.
3. Trainer. kohya_ss SDXL LoRA: rank 32 / alpha 16, ~1500-3000 steps, 1024px,
   AdamW8bit, bf16, checkpoint every ~250 steps. Runs on the ephemeral box.
4. Validator (extends the existing ArcFace contact-sheet harness). Over a fixed
   prompt + seed set, generate with the LoRA chain vs the current InstantID-only
   chain; compute mean ArcFace cosine similarity vs reference. The LoRA must not
   regress the current chain to be promoted, and this step selects the best
   checkpoint (early checkpoints often beat the final). Write a side-by-side sheet.
5. Promoter. On pass: upload the winning LoRA to S3, set `CharacterLora.status =
   ready`, `s3Key`, `triggerToken`, `baseModel`, `arcfaceScore`. On fail: leave the
   character on the InstantID path, mark `rejected` / `failed`, log.

Orchestration flow: admin action -> `train-lora` job enqueued to a training queue
-> ephemeral box scales up -> build (may call the live box for the turntable) ->
caption -> train -> validate -> promote -> box scales to zero. Capacity errors
(InsufficientInstanceCapacity, a known pain) back off and retry a fallback AZ;
training is async so this is tolerable.

### Subsystem B - Enhanced generation (evolve existing)

Changes in `backend/src/media/image/workflow/`:

- Base model selection. RealVisXL checkpoint for LoRA-enabled characters, Juggernaut
  XL v9 for the rest. Derived from LoRA presence (`CharacterLora.baseModel`), not a
  global swap, so the 143 personas whose references were made on Juggernaut do not
  regress.
- LoRA loader block (`workflow/lora.ts`, new). When a `ready` LoRA exists: insert a
  `LoraLoader` after the checkpoint at strength ~0.8-0.9, inject the trigger token
  into the positive prompt, and lower InstantID `ip_weight` from 1.05 to ~0.5-0.7
  (LoRA now carries identity; double-locking causes the stiff copy-paste look).
  inswapper is kept for near-frontal shots as a final pixel lock and inside the
  validator; it is not the identity source.
- The non-negotiable tail. Turn the already-coded, flag-gated nodes ON for
  LoRA-enabled characters: FaceDetailer (denoise <= 0.35) -> `hand_yolov9c` hand
  detailer -> a new 2x upscale + skin/texture pass (`workflow/upscale.ts`). This is
  what kills plastic skin and rebuilds hands.
- Pose + expression control. The already-spec'd body-only DWPose ControlNet (head
  keypoints stripped, head free) drives pose; a curated expression menu drives
  expression via prompt tokens plus the FaceDetailer prompt. Both exposed as enums.

## Data model

`AppearanceSheet.loraRef` already exists but is coarse. Add a dedicated table for
audit and retrain history rather than overloading the sheet:

```prisma
model CharacterLora {
  id                 String   @id @default(uuid())
  characterId        String
  characterVersionId String
  status             String   // pending|building|training|validating|ready|rejected|failed
  s3Key              String?  // trained weights
  triggerToken       String?  // e.g. ch_a1b2c3
  baseModel          String   // realvisxl_v5 | juggernaut_xl_v9
  rank               Int      @default(32)
  checkpointStep     Int?
  arcfaceScore       Float?   // validator result vs current chain
  datasetKey         String?  // S3 manifest of curated training images
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([characterId])
  @@index([status])
}
```

Generation reads `status = ready` plus `s3Key` and `triggerToken`. When present it
also mirrors `s3Key` into `AppearanceSheet.loraRef` for the simple read path.
Expression and pose are runtime enums in `@buttercupp/shared`; no DB change.

## Shared schema (`@buttercupp/shared`)

- `expressionEnum`: neutral | smiling | happy | sad | seductive | laughing | surprised.
- `poseEnum`: a curated set keyed to the pose-skeleton library (front, three-quarter,
  profile, over-shoulder, sitting, lying, arms-up, ...), with a text fallback.
- `trainLoraJobPayloadSchema`: characterId, characterVersionId, requestedBy,
  targetImageCount, options. Validated at the trust boundary like all media jobs.
- `CharacterLora` status type mirrored for the client.

## Flags and staged rollout

New flags, env + per-request override, default OFF (byte-identical when off):

- `IMG_LORA` - enable the LoRA loader block when a `ready` LoRA exists.
- `IMG_UPSCALE_TAIL` - enable the 2x upscale + skin pass.

The tail flags from the 2026-08-23 track (`IMG_FACEDETAILER`, `IMG_HAND_DETAILER`,
`IMG_POSE_CONTROLNET`) are turned ON specifically for LoRA-enabled characters.

Build order (lowest risk first):

1. Generation tail: FaceDetailer + hand detailer + upscale + pose ON for one test
   character; pass the identity gate. (Mostly already coded; adds the upscale node.)
2. RealVisXL base evaluation for a flagship character (identity gate vs Juggernaut).
3. Training pipeline: ephemeral box + dataset builder + captioner + trainer +
   validator + promoter, end to end for one character.
4. LoRA loader block in generation + InstantID weight reduction.
5. Expression / pose menu surfaced in the chat and creation flows.
6. Train the flagship ~10-20, validate each against the gate, then expand.

## Error handling

- Training failure or validation regression: never promote; character stays on the
  InstantID path; status `rejected` / `failed` + log.
- Missing LoRA node/model on the box: workflow builder falls back to the non-LoRA
  graph and logs.
- Ephemeral-box capacity error: backoff + fallback AZ; async so tolerable.
- Turntable generation failure during dataset build: fall back to existing gallery
  images; if too few remain, abort the job with a clear error (do not train on a
  thin dataset).
- Existing Fal / Replicate fallback chain untouched.

## Testing

- Identity gate (extend existing harness): LoRA chain mean ArcFace cosine >= current
  chain on a fixed prompt + seed set, with contact sheets.
- Expression x pose matrix per validated character: identity must hold across all
  expressions (the known failure mode); gate each cell.
- Hand check: hand-keypoint confidence and qualitative pre-vs-post hand detailer.
- Byte-identical invariant: with all new flags off, the workflow JSON is unchanged.
- Unit tests for the new workflow blocks (LoRA loader, upscale tail) as pure
  node-graph assembly tests, no GPU, following the existing block tests.

## Prod-touching work (author locally, approval-gated to run)

These are written in this track but NOT executed without a fresh per-action ask:

- Provisioning the ephemeral training box (AWS), its AMI, kohya + ComfyUI + model
  downloads (RealVisXL, upscaler, LoRA training deps).
- Running real LoRA training jobs on GPU.
- Any migration against a non-local database; any deploy; any commit or push.

## Out of scope

- FLUX / FLUX.2 / Qwen engines (revisit as a later spike if licensing or NSFW
  maturity changes).
- LoRA for user-created characters (deferred; needs paywall/quota).
- Stheno text-generation quality.
- The Wan 2.2 video track.

## Appendix - research sources

Per-character LoRA as the fidelity ceiling (kohya SDXL rank 32, early-checkpoint
selection, ~0.33 face:body dataset ratio); RealVisXL as photoreal SDXL base with
commercial NSFW viability; FLUX.1-dev non-commercial + NSFW-weak, InfiniteYou
CC-BY-NC (disqualified); FaceDetailer + upscale tail as non-negotiable against
plastic skin; stack LoRA (identity) + InstantID at reduced weight + inswapper final
lock rather than any single method. Full technical notes and URLs captured in the
brainstorming research pass (2026-08-30).
