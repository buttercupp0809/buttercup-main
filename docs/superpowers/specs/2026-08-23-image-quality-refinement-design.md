# Image Quality Refinement (identity-preserving) - Design

Date: 2026-08-23
Status: Draft for review
Track: A (of two). Independent of the Wan 2.2 video track.

## Goal

Improve Juggernaut XL image quality on three user-reported problems WITHOUT
regressing the existing character-consistency lock:

1. Face blur / softness (faces are tiny because the subject is framed far from camera).
2. Face distortion when the head turns even slightly (three-quarter / over-shoulder).
3. Weak, unreliable body pose control (specific poses do not render effectively).

Hard constraint from the user: "do not disturb consistency if you cannot add
more quality." Every change is additive, staged, and behind an A/B flag so any
stage that does not clearly improve output without regressing identity is not kept.

## Current pipeline (what must not break)

File: `backend/src/media/image/providers.ts`, `generateWithComfyUIConsistent()`
and `buildInstantIdWorkflow()`.

Node graph today:
```
CheckpointLoaderSimple(4) + EmptyLatentImage(5, 768x1344)
CLIPTextEncode pos(6) / neg(7)
LoadImage(10, reference face)
InstantIDModelLoader(20) + InstantIDFaceAnalysis(21, CPU) + ControlNetLoader(22)
ApplyInstantIDAdvanced(23): ip_weight=1.05, cn_strength=0.0, end_at=0.75
KSampler(3): 30 steps, cfg 4.5, dpmpp_2m/karras, denoise 1
VAEDecode(8)
PoppyFaceSwap(50): inswapper_128 exact face copy + GPEN-BFR-512 restore
SaveImage(9)
```
Identity is locked at three levels: InstantID ArcFace embedding (ip_weight 1.05),
inswapper pixel copy, GPEN restore. ControlNet is at strength 0.0 so the head is
free to rotate; pose is text-only via a 6-entry `POSE_DESCRIPTORS` cycle.

Root causes (from research, see appendix):
- Blur: face occupies ~100-150px of a 1344px frame ("standing far from camera"
  prefix). GPEN-512 cannot add detail that is not present. FaceDetailer
  (installed via Impact-Pack but NOT wired) is the missing high-res re-diffusion step.
- Turn distortion: inswapper_128 uses a rigid 2D similarity transform onto a
  frontal template. It cannot reproject onto a yawed head, so angled faces shear.
  ArcFace embedding error is ~12% at profile vs ~0% frontal.
- Poses: ControlNet disabled means nothing drives body pose except text, which
  SDXL follows loosely.

## Design: the refined workflow

Target end-state node graph (all additions gated, see Flags):
```
InstantID (ip_weight 0.7-0.8) + body OpenPose ControlNet (head keypoints stripped,
    strength ~0.6, start 0.0, end ~0.6)
  -> KSampler (Juggernaut XL v9, 768x1344, 30 steps, cfg 4.5, dpmpp_2m/karras)  [UNCHANGED]
  -> yaw gate:
       |yaw| < 30 deg  -> PoppyFaceSwap (inswapper_128)         [current lock, kept]
       |yaw| >= 30 deg -> skip inswapper, PuLID-SDXL carries identity
  -> FaceDetailer (face_yolov8m, denoise 0.25, guide_size 768)  [fixes tiny-face blur]
  -> Hand detailer (hand_yolov9c, denoise ~0.5)                 [fixes hands, face untouched]
  -> GPEN-BFR-512 (visibility ~0.6) or CodeFormer fallback
```

Ordering is load-bearing: FaceDetailer runs AFTER the swap at LOW denoise (<=0.35)
so it sharpens the swapped face without regenerating (and overwriting) identity.
Hand detailer runs LAST; hand SEGS never include the face, so identity is safe by
construction.

### Fix 1 - FaceDetailer (blur)
- Node: `FaceDetailer` (ComfyUI-Impact-Pack) + `UltralyticsDetectorProvider`
  (ComfyUI-Impact-Subpack, new install).
- Model: `face_yolov8m.pt` -> `models/ultralytics/bbox/`.
- Settings: denoise 0.25 (hard cap 0.35), guide_size 768, guide_size_for=bbox,
  max_size 1024, bbox_crop_factor 3.0, bbox_dilation 6, feather 8,
  bbox_threshold 0.45, noise_mask on, force_inpaint on, cycle 1, 24 steps, cfg 7,
  dpmpp_2m/karras.
- Also lower GPEN visibility from 1.0 to ~0.6 (change inside PoppyFaceSwap or add a
  terminal CodeFormer restore at codeformer_weight ~0.6 when identity drifts).

### Fix 2 - Yaw-gated identity (turn distortion)
- Add head-yaw estimation (from InstantID/InsightFace analysis already in the graph,
  or a dedicated pose estimate).
- Below ~30 deg: keep inswapper_128 (best frontal signal, unchanged).
- At/above ~30 deg: skip inswapper; rely on PuLID-SDXL (`ComfyUI_PuLID`, new install,
  PuLID-SDXL weights) which conditions diffusion and follows head rotation.
- Do NOT globally replace inswapper; gate it. inswapper remains best for frontal.

### Fix 3 - Hand detailer (hands / anatomy)
- Node: `UltralyticsDetectorProvider` -> `BboxDetectorSEGS` -> `DetailerForEach`.
- Model: `hand_yolov9c.pt` (best, mAP50 0.81) -> `models/ultralytics/bbox/`.
- Settings: denoise 0.4-0.55, guide_size 768-1024, bbox_threshold 0.3-0.5,
  bbox_dilation 10-20 (moderate so a hand-near-face pose does not dilate onto chin),
  crop_factor 3.0, feather 5-10, no SAM.
- Optional later: MeshGraphormer HandRefiner. SD1.5-only refiner ControlNet means
  either an SD1.5 sub-step or the native `xinsir/controlnet-depth-sdxl-1.0` path;
  deferred to a follow-up if the YOLO detailer is insufficient.
- Note: SD1.5 hand negative embeddings do NOT work on SDXL; do not rely on them.

### Fix 4 - Body pose control with free head
- Stop running ControlNet at 0.0. Add a real OpenPose ControlNet for the BODY only.
- Model: `xinsir/controlnet-openpose-sdxl-1.0` -> `models/controlnet/`.
- Preprocessor: `DWPreprocessor` (comfyui_controlnet_aux), body+hands enabled.
- Free the head: route keypoints through `ComfyUI-ultimate-openpose-editor` with
  `show_face=false` so the skeleton has no head points -> body pinned, head free.
- Apply via `Apply ControlNet (Advanced)`: strength 0.55-0.7, start 0.0, end 0.5-0.7
  (late steps free the face so InstantID settles). Never end_percent 1.0.
- Reduce InstantID ip_weight from 1.05 to 0.7-0.8 (1.05 is high and can stiffen
  expression). Keep total non-InstantID ControlNet under ~1.0.
- Add a curated pose-skeleton library keyed off user pose hints (sitting, lying,
  arms up, etc.); fall back to the current text descriptors when no pose matches.

## Components and boundaries

- `backend/src/media/image/providers.ts` - workflow builder. Refactor
  `buildInstantIdWorkflow()` into composable node-group helpers (base, instantid,
  pose-controlnet, facedetailer, handdetailer, faceswap) so each fix is an
  independently toggled block. This file is already large; splitting the builder
  into a `workflow/` submodule keeps each block understandable and testable.
- `backend/src/media/image/constants.ts` - new tunables (detailer denoise, yaw
  threshold, controlnet strength/end, ip_weight) with env overrides.
- GPU box provisioning: `Plans/inference-aws/user-data.sh` - add the new custom
  nodes (Impact-Subpack, ultimate-openpose-editor, PuLID) and model-file downloads
  (face_yolov8m, hand_yolov9c, xinsir openpose SDXL, PuLID-SDXL). This is the
  known-good box; changes are additive and must not alter the Stheno/Juggernaut
  services. Requires a box redeploy (approval-gated).

## A/B flags and staged rollout

Each fix is a boolean flag (env + per-request override), default OFF, enabled one
at a time:
- `IMG_FACEDETAILER` (Fix 1)
- `IMG_YAW_GATE` / `IMG_PULID` (Fix 2)
- `IMG_HAND_DETAILER` (Fix 3)
- `IMG_POSE_CONTROLNET` (Fix 4)

Rollout order (lowest risk first): Fix 1 -> Fix 3 -> Fix 4 -> Fix 2. After each,
run the comparison harness (below) and keep the flag on only if it improves quality
without regressing identity.

## Testing

- Comparison harness: a script that, given a fixed reference face + fixed seed +
  a fixed prompt set (frontal, three-quarter, over-shoulder, plus pose prompts:
  sitting, arms up, lying), generates BEFORE (current chain) and AFTER (each flag)
  and writes a side-by-side contact sheet for human review.
- Identity-regression check: cosine similarity of ArcFace embedding between the
  reference face and the generated face, per variant. A stage must not lower mean
  similarity vs the current chain (that is the "do not disturb" gate, made numeric).
- Unit tests: workflow-builder helpers assemble the correct node graph per flag
  combination (pure-function tests, no GPU needed).

## Error handling

- If a new custom node or model file is missing on the box, the workflow builder
  falls back to the current (pre-fix) graph and logs, rather than failing the job.
- Yaw estimation failure -> default to the frontal path (inswapper), never break.
- Existing Fal/Replicate fallback chain (`generateImage`) is untouched.

## Out of scope

- Text generation (Stheno) quality changes. The user's request centers on image
  quality; Stheno tuning is not part of this track.
- Replacing Juggernaut XL or the base sampler settings.
- The Wan 2.2 video track (separate spec).

## Appendix - research sources

InstantID + FaceDetailer ordering; inswapper frontal-only limitation (rigid 2D
similarity transform, no 256/512 release); PuLID-SDXL for angled identity;
hand_yolov9c detailer; xinsir OpenPose SDXL + head-keypoint stripping via
ultimate-openpose-editor. Full technical notes captured in the brainstorming
research pass (2026-08-23).
