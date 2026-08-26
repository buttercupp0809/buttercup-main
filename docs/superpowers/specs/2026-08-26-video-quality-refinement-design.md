# Video Quality Refinement (Wan 2.2 i2v) Design

**Date:** 2026-08-26
**Status:** Approved, implementing
**Goal:** Eliminate lighting flicker, make the pipeline follow the user's action
intent, smooth motion, and raise fidelity toward Candy AI parity. Tuning +
prompt engineering, NOT a rearchitecture. Base stays Wan 2.2 i2v + InstantID
first-frame lock (architecturally the same class as Candy AI "Live Action").

## Decisions (locked)
- **Quality-first** sampling: stop fighting the Lightning LoRA; use proper cfg +
  more steps for stable lighting and prompt adherence. Longer render is OK.
- **Identity:** tune the existing InstantID Stage-A path; NO per-character LoRA
  training this phase (documented as a future spec).

## Root causes (grounded in code)
1. **Flicker = cfg/LoRA mismatch.** `WAN_STEPS.balanced` runs the high-noise
   expert at cfg 3.5 WITH the Lightning LoRA at 0.7. Lightning is distilled for
   cfg approximately 1.0; cfg 3.5 fights it and pulses brightness / flashes the
   face, worse at only 4+4 steps.
2. **Weak prompt adherence.** Low cfg (needed by Lightning) weakens following;
   the user's action is appended as `scene: <text>` AFTER identity/style; and
   `motionTags` / `qualityTags` / `negativeExtra` in prompt-fills.ts are EMPTY.
3. **No motion smoothing.** RIFE interpolation exists in `workflow.ts` but is
   gated off (`WAN_INTERPOLATION=0`, RIFE node not installed).

## Changes

### 1. Sampling recipe (constants.ts `WAN_STEPS`, workflow.ts)
Quality presets DROP the Lightning LoRA and use full cfg + more steps; any
Lightning-based preset gets cfg forced to the correct ~1.0.
- `fast`: Lightning, cfg 1.0 both experts (already correct; keep) - fastest.
- `balanced` (UI default, NEW quality recipe): no LoRA, high{steps 8, cfg 3.5},
  low{steps 8, cfg 3.5}, shift 5, 480p.
- `max`: no LoRA, high{steps 10, cfg 4.0}, low{steps 10, cfg 3.5}, shift 5, 720p.
**Exact step/cfg values are STARTING points; locked via side-by-side test renders
on the box (each 8s clip is ~9-18 min).**

### 2. Prompt engineering
- **New `video/prompt-expand.ts`:** LLM (existing OpenRouter/Anthropic keys)
  turns a terse `userRequest` into a structured Wan i2v motion prompt (primary
  action, secondary natural motion, subtle camera, consistent lighting; <= ~60
  words; must NOT alter identity/appearance). Non-fatal: deterministic template
  fallback on any LLM failure (mirrors `restyleFirstFrame` null-fallback).
- **`prompt.ts` restructure:** lead the positive prompt with the expanded ACTION,
  then identity traits, style flavor, motion/quality tags.
- **`prompt-fills.ts` filled:**
  - motionTags: `natural subtle motion, smooth gentle movement, stable camera, consistent lighting`
  - qualityTags: `high detail, sharp focus, cinematic, temporally stable`
  - negativeExtra: `flickering, brightness flicker, strobing, exposure shift, flashing, warping, morphing, jitter, duplicated frames, ghosting, identity drift`

### 3. Motion smoothness
- Install the RIFE node on the box (`install-rife.sh`), set `WAN_INTERPOLATION=1`,
  enable `interpolate` for quality presets -> 16fps to 32fps.
- Prompts bias toward controlled natural motion (breathing, head turns, the
  requested action); big scene motion is avoided (more stable, matches the
  "basic but consistent" competitor motion).

### 4. Identity (InstantID tuning, restyle.ts)
- Strengthen first-frame identity lock (identity weight, tune
  `VIDEO_REFINE_DENOISE`) so the locked face carries cleanly into the video.
  The first frame is inherited by the whole clip, so its quality dominates.

### 5. Resolution
- Offer a 720p tier (`VIDEO_ASPECTS_HQ` 720x1280) on `max`, now that the box has
  64GB RAM headroom. Validate RAM/time before defaulting on.

### 6. Testing harness
- `backend/scripts/video-quality-bench.ts`: enqueue the same character+prompt
  across recipe variants, report timing + s3Key so variants can be compared
  visually, and the default locked from evidence.

## Files touched
`constants.ts`, `workflow.ts`, `prompt.ts`, `prompt-fills.ts`,
new `prompt-expand.ts`, `handlers/video.ts`, `restyle.ts`, `backend/.env`
(knobs), the box (RIFE node), new bench script.

## Out of scope (future specs)
Per-character LoRA training; ControlNet/pose guidance; true text-to-video;
cinematic camera motion.

## Validation
Numbers in sections 1/3/5 are starting points. Each is locked by rendering the
same 8s clip per variant and comparing flicker, adherence, motion, and time.
