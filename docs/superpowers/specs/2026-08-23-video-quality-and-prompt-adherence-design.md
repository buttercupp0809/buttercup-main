# Video Quality and Prompt Adherence Design

**Date:** 2026-08-23
**Status:** Draft for review
**Supersedes/extends:** `2026-08-23-wan22-video-hosting-design.md` (the base
Wan 2.2 A14B self-hosting design). This document only changes the generation
pipeline (prompt adherence, motion smoothness, duration); hosting, billing,
scale-to-zero, and the queue/worker plumbing are unchanged.

## Problem

Three user-reported defects in the self-hosted Wan 2.2 i2v reel pipeline:

1. **The typed prompt is ignored.** A user asks for "blue dress on a beach";
   the clip keeps the character's original outfit and background. Reproduced on
   the `balanced` preset (which already runs the high-noise expert at cfg 3.5
   without the Lightning LoRA), so this is NOT a guidance-strength bug.
2. **Motion is not smooth.** Clips look choppy / juddery and sometimes
   slideshow-slow.
3. **No 8-second option.** The UI caps duration at 5s.

## Root Cause

Confirmed by codebase trace + market/technical research (see
`scratchpad/research-technical.md` and the market findings in the session):

1. **Prompt ignored is structural, not tunable.** In image-to-video the input
   reference image *becomes frame 0* and conditions the whole clip. Outfit,
   background, and pose are therefore locked into the first frame. Wan 2.2 also
   dropped clip_vision conditioning, so the text prompt can only add *motion*;
   it cannot repaint a scene that is already fixed in frame 0. Raising CFG does
   not help (already proven on `balanced`). The only reliable fix is to change
   what frame 0 *is*.
2. **Motion has two stacked causes.** (a) Wan A14B is genuinely **16fps
   native** (81 frames = ~5.06s) with **no frame interpolation** in our graph,
   so playback is choppy versus the 24fps norm of Kling/Runway/Veo/Seedance.
   (b) The LightX2V Lightning distill LoRA is an acknowledged upstream cause of
   slow / "live-wallpaper" motion when applied to the **high-noise** (motion-
   setting) expert. Interpolation smooths judder but does NOT restore lost
   motion, so both must be addressed.
3. **Duration is a UI gap.** The zod schema already allows `seconds` 1-10 and
   `secondsToFrames` already snaps to the 4n+1 grid (8s → 129 frames). The
   frontend just never offered 8s.

## Goals

- Make the typed prompt actually drive the visible outfit / scene / setting in
  i2v reels, while preserving the character's face identity.
- Deliver visibly smoother motion (target 32fps perceived) without the
  slideshow-slow artifact.
- Offer 3s / 5s / 8s durations end to end.
- Keep the character-consistency guarantees of the existing image pipeline
  intact (reuse it, do not reinvent it).

## Non-Goals

- No change to hosting, scale-to-zero, billing, token accounting, the BullMQ
  queue, or the WS notify path.
- No new cloud video provider. The Fal/Replicate fallback chain is untouched.
- No camera-motion preset UI, motion-brush, or first/last-frame keyframe editor
  (possible later; explicitly out of scope now).
- No change to the image (still-photo) generation pipeline's own output.

## Approach: a three-stage i2v pipeline

Today: `reference photo → uploaded as frame 0 → Wan i2v → 16fps webm`.

New (self-hosted path only; cloud fallback unchanged):

```
Stage A  Restyle first frame   (fixes prompt adherence)
Stage B  Wan i2v, motion-tuned  (fixes weak/dead motion)
Stage C  RIFE interpolation     (fixes choppiness) → 32fps webm
```

### Stage A - First-frame restyle (the core fix)

When the video's scene mode is **Transform** (the default), we do NOT feed the
raw reference photo to Wan. Instead we first render a *new* first frame that
already depicts the requested outfit / scene / pose, with the character's face
preserved, by reusing the **existing SDXL identity image pipeline**
(InstantID / PuLID / faceswap in `backend/src/media/image/*`, the same code
that produces in-chat selfies in `chat/image-turn.ts`). That generated image
becomes the i2v conditioning frame.

- Input: `characterId`, the user's typed request, and the video `aspect`
  (portrait/landscape/square) so the restyled frame matches the clip's aspect.
- The restyle prompt = the character-defining fragment (identity/appearance,
  which keeps the face consistent) + the user request as the scene/outfit
  directive. This is the same "stable identity fragment + variable scene"
  contract `buildVideoPrompt`/`buildImagePrompt` already use.
- Output: PNG/JPEG bytes. These bytes are uploaded to the Wan box as the i2v
  reference frame (the existing `resolveCharacterReferenceBytes` → upload path
  is replaced by these restyled bytes for Transform mode).
- Identity is guaranteed by InstantID/PuLID face conditioning, exactly as in
  the image pipeline. The restyle changes clothing/scene/pose; it does not
  invent a new person.

When scene mode is **Keep**, Stage A is skipped and the pipeline uses the
character's real reference bytes (today's behavior) for a faithful, motion-only
clip. This is the per-video toggle the user chose.

**Where restyle runs.** Reuse the existing image-generation path/box (the g5
image box via the current image provider chain), not the video box. Rationale:
the InstantID/PuLID/faceswap models and the proven workflow already live there;
duplicating them onto the g6e video box would be a large, redundant install and
a second source of drift. The video handler already fetches image bytes across
boxes, so a restyled image is just one more image fetch. Cost: one SDXL
generation per Transform video (and an image-box wake if it is scaled to zero).

**Failure handling.** If the restyle fails or returns no image, fall back to the
raw reference bytes (degrade to Keep behavior) rather than failing the whole
job, and record `restyle: "failed"` in the job meta. i2v with no usable frame
still errors as today (`video_reference_unresolvable`).

### Stage B - Wan i2v tuned for real motion

Rework the sampling presets so the default follows the community-proven
"3-sampler" motion pattern and runs at a motion-friendly resolution.

- **High-noise expert (motion director):** no Lightning LoRA, CFG ~4, more
  steps. This restores real motion direction (the LoRA on this expert is what
  flattens motion).
- **Low-noise expert (refiner):** keep the Lightning LoRA at full strength,
  CFG 1.0, few steps, for speed on refinement.
- `WAN_SHIFT = 5` (distillation-matched), sampler euler / scheduler simple, as
  today.
- **Resolution bump:** raise the base from 480p toward 720p-class dims for the
  quality default, since low resolution correlates strongly with the slow-motion
  artifact under Lightning. Aspects keep their orientation; dims stay divisible
  by 16.

Preset table after rework (self-hosted Wan):

| Preset | High-noise expert | Low-noise expert | Interp (Stage C) | Restyle default | Target time |
|--------|-------------------|------------------|------------------|-----------------|-------------|
| balanced (default) | no LoRA, cfg 4, ~6 steps | LoRA, cfg 1, ~4 steps | RIFE x2 → 32fps | Transform | ~3-5 min |
| fast | LoRA, cfg 1, 4 steps | LoRA, cfg 1, 4 steps | none | Keep | ~1-2 min |
| max | no LoRA, cfg 4, ~10 steps | no LoRA, cfg 3.5, ~8 steps | RIFE x2 → 32fps | Transform | ~8-12 min |

`balanced` remains the default (the user chose the ~3-5 min quality target).
`fast` is retained as a quick preview lane that intentionally skips restyle +
interpolation. Exact step counts are tunable during implementation; the
invariant is: high-noise expert carries no Lightning LoRA on balanced/max.

### Stage C - Frame interpolation

After `VAEDecode`, insert a **RIFE VFI** node (from the
`ComfyUI-Frame-Interpolation` custom node pack, checkpoint `rife49.pth`) at
`multiplier = 2`, then set the `SaveWEBM` node's `fps` to `WAN_FPS * 2` (32).
This doubles perceived smoothness with zero extra diffusion cost. FILM is the
documented fallback for very large motion (not wired now; noted for later).

Interpolation is applied only on presets that opt in (balanced, max), keeping
`fast` a raw quick-look.

### Duration

- Frontend duration options become **3s / 5s / 8s**.
- Backend already supports it: `secondsToFrames(8, 16)` → **129 frames**.
- 8s uses a single Wan pass for now. Known caveat: frames past ~121 can drift
  or burn on a single pass. If QA shows this, a follow-up adds last-frame
  chaining (two 81-frame passes stitched); it is out of scope for this change
  and called out as the fallback, not built now.

## Data flow

```
CreateVideoForm (prompt, aspect, seconds ∈ {3,5,8}, sceneMode ∈ {transform,keep}, quality)
  → createVideoPayloadSchema (adds sceneMode)
  → videoHandler
       buildVideoPrompt(appearanceSheet, userRequest)            [motion prompt]
       if sceneMode == transform:
           restyleFirstFrame(characterId, userRequest, aspect)   [Stage A, image box]
             → restyled image bytes  (fallback: resolveCharacterReferenceBytes)
       else:
           resolveCharacterReferenceBytes(characterId)           [raw photo]
       generateVideo({ mode:i2v, referenceBytes, preset, aspect, seconds })
         → generateWithComfyWan
              buildWanWorkflow(...)   [Stage B presets + Stage C RIFE node]
              → box → 32fps webm
  → upload + WS notify (unchanged)
```

## Interfaces to add / change

- `packages/shared` - `createVideoPayloadSchema`: add
  `sceneMode: z.enum(["transform","keep"]).default("transform")`. `seconds`
  is already `1..10`; no schema change, only the UI exposes 8.
- `backend/src/media/video/restyle.ts` (new) -
  `restyleFirstFrame(characterId: string, userRequest: string, aspect: VideoAspect): Promise<Buffer | null>`.
  Thin wrapper over the existing image-generation path; returns null on failure.
- `backend/src/media/handlers/video.ts` - branch on `sceneMode`; call
  `restyleFirstFrame` for transform, else `resolveCharacterReferenceBytes`;
  pass resulting bytes to `generateVideo`; record `restyle` + `sceneMode` in
  meta.
- `backend/src/media/video/constants.ts` - rework `WAN_STEPS` per the table;
  add interpolation config (multiplier, output fps, rife checkpoint name);
  bump aspect base resolution for quality presets.
- `backend/src/media/video/workflow.ts` - high-noise expert LoRA gating per new
  presets; insert RIFE VFI node between `VAEDecode` and `SaveWEBM` for presets
  with interpolation; set `SaveWEBM.fps` to the interpolated fps.
- `frontend/components/create-video/CreateVideoForm.tsx` - add 8s to
  `DURATIONS`; add a Transform/Keep toggle (default Transform) with helper copy
  ("Transform: put your character in a new outfit/scene from your prompt. Keep:
  animate your exact photo.").

## Infrastructure

The video box needs the interpolation custom node installed once:

- `ComfyUI-Frame-Interpolation` (Fannovel16) in `ComfyUI/custom_nodes/`.
- `rife49.pth` checkpoint in the pack's model dir.

Add these to `Plans/inference-video-aws/user-data.sh` (and a one-off install
step for the already-running box, documented in the plan). No other infra
change.

## Testing

- **Unit (hermetic, no box):**
  - `restyleFirstFrame` returns bytes on success and `null` on failure; handler
    falls back to raw reference bytes when it returns null.
  - `buildWanWorkflow`: high-noise expert has NO Lightning LoRA on balanced/max
    and DOES on fast; a RIFE node exists between decode and save for
    balanced/max and is absent on fast; `SaveWEBM.fps == 32` when interpolation
    is on, `16` when off.
  - `createVideoPayloadSchema` parses `sceneMode` with a `transform` default and
    rejects unknown values; `seconds: 8` is accepted.
  - `secondsToFrames(8,16) === 129`.
- **Box smoke (manual, gated by `POPPY_WAN_URL`):** a helper script renders one
  transform clip and one keep clip, asserts a valid 32fps WebM, and prints
  latency per preset. Reuses the existing `wan-i2v-e2e.ts` harness pattern.
- **UI:** 8s selectable; toggle defaults to Transform; a Transform render
  visibly changes outfit/scene while the face stays recognizable; a Keep render
  animates the original photo.

## Rollout / risk

- All changes are behind the existing self-hosted path; the cloud fallback and
  the stub-clip dev path are untouched, so nothing regresses when the box is
  down.
- The Transform default adds an image generation per video (cost + latency).
  The Keep toggle and the `fast` preset give users (and us) a cheap path.
- If 8s single-pass quality is poor, the documented fallback is last-frame
  chaining (separate follow-up).
- Infra risk: the RIFE node/checkpoint must be present on the box or Stage C
  fails. The workflow builder must not emit the RIFE node unless the box is
  known to have it; gate Stage C on a config flag defaulting off until the box
  is provisioned, then flip it on.
```
