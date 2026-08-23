# Image Quality Refinement (identity-preserving) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix face blur, angled-face distortion, weak hands, and unreliable poses in the Juggernaut XL ComfyUI pipeline without regressing the existing InstantID + Inswapper character-consistency lock.

**Architecture:** Refactor the monolithic `buildInstantIdWorkflow()` in `providers.ts` into composable, individually flag-gated ComfyUI node-group builders under a new `workflow/` submodule. Each of the four fixes (FaceDetailer, hand detailer, body pose ControlNet, yaw-gated angle handling) is an additive block, default OFF, enabled one at a time and validated against the current chain by a before/after harness plus a numeric ArcFace identity-similarity gate.

**Tech Stack:** Node + TypeScript (CommonJS build), vitest, ComfyUI (Impact-Pack/Subpack, PuLID, controlnet_aux, ultimate-openpose-editor), Juggernaut XL v9 (SDXL), InstantID, Inswapper, GPEN/CodeFormer.

**Spec:** `docs/superpowers/specs/2026-08-23-image-quality-refinement-design.md`

## Global Constraints

Copied verbatim from repo rules (`CLAUDE.md`) and the spec. Every task's requirements implicitly include this section.

- There is exactly one `PrismaClient` per process. Never write `new PrismaClient()` outside `packages/database/src/client.ts`. Import `{ prisma } from "@buttercupp/database"`.
- Do not use the em dash character (U+2014) anywhere: code, comments, docs, commit messages. Use commas, periods, or parentheses.
- Strict TypeScript everywhere. No `any` unless annotated with a comment explaining why the type cannot be modeled.
- `zod` validates every mutation at the trust boundary. Never trust shape from types alone.
- Backend TS compiles to CommonJS in `dist/`.
- Tests use vitest. Run a single file with `npx vitest run <path>` from the repo root; run all with `npm test`. Tests are colocated as `*.test.ts` or under a sibling `__tests__/` directory.
- Do NOT disturb the identity lock. The numeric gate: mean ArcFace cosine similarity (reference vs generated face) must not drop versus the current chain for any flag that stays enabled.
- APPROVAL-GATED (never auto-run, ask the human per-action): any `git commit` / `git push`; redeploying the GPU box; any AWS CLI mutation. Commits and box redeploys in this plan are performed by the human/executor.

---

## File Structure

New and modified files, each with one responsibility.

- `backend/src/media/image/constants.ts` (MODIFY) - add the A/B flag defaults + new tunables (detailer denoise/guide_size, yaw threshold, controlnet strength/end, ip_weight override, GPEN visibility). Owns image tunables.
- `backend/src/media/image/flags.ts` (CREATE) - resolve effective flags from env + per-request override into a typed `ImageWorkflowFlags`. One responsibility: flag resolution.
- `backend/src/media/image/workflow/base.ts` (CREATE) - checkpoint + latent + CLIP encode nodes (nodes 4,5,6,7). The unchanged core.
- `backend/src/media/image/workflow/instantid.ts` (CREATE) - InstantID loader/analysis/controlnet/apply nodes (10,20,21,22,23) with configurable ip_weight.
- `backend/src/media/image/workflow/pose-controlnet.ts` (CREATE) - DWPose + ultimate-openpose-editor (head stripped) + OpenPose ControlNet apply block (Fix 4).
- `backend/src/media/image/workflow/facedetailer.ts` (CREATE) - FaceDetailer node block (Fix 1).
- `backend/src/media/image/workflow/handdetailer.ts` (CREATE) - hand YOLO DetailerForEach block (Fix 3).
- `backend/src/media/image/workflow/faceswap.ts` (CREATE) - PoppyFaceSwap block with GPEN visibility + yaw-gate skip (Fix 2).
- `backend/src/media/image/workflow/assemble.ts` (CREATE) - compose the enabled blocks into a single ComfyUI graph in the correct order. Replaces the body of `buildInstantIdWorkflow`.
- `backend/src/media/image/providers.ts` (MODIFY) - `generateWithComfyUIConsistent()` calls `assembleConsistentWorkflow()` from the submodule; adds yaw estimation input and per-request flags; keeps the Fal/Replicate fallback untouched.
- `Plans/inference-aws/user-data.sh` (MODIFY) - additive install of the new custom nodes + model files on the known-good box (approval-gated redeploy).
- `backend/scripts/image-quality-harness.ts` (CREATE) - before/after contact-sheet generator + ArcFace similarity gate.

Ordering follows the spec's staged rollout: refactor first (Task 1), then FaceDetailer (2), hand detailer (3), pose ControlNet (4), yaw-gate (5), box provisioning (6), harness (7).

---

## Task 1: Refactor workflow builder into flag-gated blocks

Extract the current `buildInstantIdWorkflow()` graph into composable block builders and an assembler, plus flag plumbing. No behavior change yet: with all flags OFF, `assembleConsistentWorkflow()` must produce the EXACT current graph (nodes 4,5,6,7,10,20,21,22,23,3,8,50,9).

**Files:**
- Create: `backend/src/media/image/flags.ts`, `workflow/base.ts`, `workflow/instantid.ts`, `workflow/faceswap.ts`, `workflow/assemble.ts`
- Modify: `backend/src/media/image/providers.ts:261-301` (replace `buildInstantIdWorkflow` internals with `assembleConsistentWorkflow`)
- Test: `backend/src/media/image/workflow/assemble.test.ts`, `backend/src/media/image/flags.test.ts`
- Reference (read): `backend/src/media/image/providers.ts` (CONSISTENT constants + `buildInstantIdWorkflow`)

**Interfaces:**
- Produces: `resolveImageFlags(override?: Partial<ImageWorkflowFlags>): ImageWorkflowFlags` where `ImageWorkflowFlags = { faceDetailer: boolean; handDetailer: boolean; poseControlNet: boolean; yawGate: boolean; pulid: boolean }` (all default false); `assembleConsistentWorkflow(a: AssembleArgs): Record<string, unknown>` where `AssembleArgs = { ckpt; positive; negative; refName; seed; flags: ImageWorkflowFlags; yawDeg?: number; poseSkeletonName?: string }`.

- [ ] **Step 1: Write the failing test (flags default OFF; graph identical to current when all OFF)**

```ts
// backend/src/media/image/flags.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveImageFlags } from "./flags";

describe("resolveImageFlags", () => {
  afterEach(() => {
    for (const k of ["IMG_FACEDETAILER","IMG_HAND_DETAILER","IMG_POSE_CONTROLNET","IMG_YAW_GATE","IMG_PULID"]) delete process.env[k];
  });
  it("defaults every flag OFF", () => {
    expect(resolveImageFlags()).toEqual({ faceDetailer: false, handDetailer: false, poseControlNet: false, yawGate: false, pulid: false });
  });
  it("reads env truthy values", () => {
    process.env.IMG_FACEDETAILER = "1";
    expect(resolveImageFlags().faceDetailer).toBe(true);
  });
  it("per-request override beats env", () => {
    process.env.IMG_FACEDETAILER = "1";
    expect(resolveImageFlags({ faceDetailer: false }).faceDetailer).toBe(false);
  });
});
```

```ts
// backend/src/media/image/workflow/assemble.test.ts
import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "juggernautXL_v9.safetensors", positive: "p", negative: "n", refName: "chat-ref.png", seed: 1 };

describe("assembleConsistentWorkflow (all flags off = current graph)", () => {
  it("produces exactly the current node ids", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    expect(Object.keys(g).sort()).toEqual(["10","20","21","22","23","3","4","5","6","7","8","9","50"].sort());
    expect((g["23"] as { inputs: { ip_weight: number; cn_strength: number } }).inputs.ip_weight).toBe(1.05);
    expect((g["23"] as { inputs: { cn_strength: number } }).inputs.cn_strength).toBe(0);
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
    // SaveImage still consumes the faceswap output when no detailers are on.
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["50", 0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/media/image/flags.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/image/flags.ts
// A/B flags for the staged image-quality rollout. Every flag defaults OFF so
// the pipeline is byte-identical to today until a flag is deliberately enabled.
export interface ImageWorkflowFlags {
  faceDetailer: boolean;
  handDetailer: boolean;
  poseControlNet: boolean;
  yawGate: boolean;
  pulid: boolean;
}
function envOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}
export function resolveImageFlags(override?: Partial<ImageWorkflowFlags>): ImageWorkflowFlags {
  const fromEnv: ImageWorkflowFlags = {
    faceDetailer: envOn("IMG_FACEDETAILER"),
    handDetailer: envOn("IMG_HAND_DETAILER"),
    poseControlNet: envOn("IMG_POSE_CONTROLNET"),
    yawGate: envOn("IMG_YAW_GATE"),
    pulid: envOn("IMG_PULID"),
  };
  return { ...fromEnv, ...(override ?? {}) };
}
```

```ts
// backend/src/media/image/workflow/base.ts
// Core nodes shared by every variant: checkpoint, empty latent, CLIP encodes.
export const CANVAS = { width: 768, height: 1344 } as const;
export function baseNodes(a: { ckpt: string; positive: string; negative: string }): Record<string, unknown> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: CANVAS.width, height: CANVAS.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: ["4", 1] } },
  };
}
```

```ts
// backend/src/media/image/workflow/instantid.ts
// InstantID identity conditioning (nodes 10,20,21,22,23) + KSampler (node 3) +
// VAEDecode (node 8). ipWeight is configurable so Fix 4 can lower it to 0.7-0.8.
export const INSTANTID_DEFAULTS = {
  ipWeight: 1.05, cnStrength: 0, endAt: 0.75, steps: 30, cfg: 4.5,
  sampler: "dpmpp_2m", scheduler: "karras",
  instantidFile: "ip-adapter.bin", controlnetFile: "instantid_control.safetensors",
} as const;
export function instantIdNodes(a: {
  refName: string; seed: number; ipWeight?: number;
  poseModelRef?: [string, number]; posePositive?: [string, number]; poseNegative?: [string, number];
}): Record<string, unknown> {
  const ipWeight = a.ipWeight ?? INSTANTID_DEFAULTS.ipWeight;
  return {
    "10": { class_type: "LoadImage", inputs: { image: a.refName } },
    "20": { class_type: "InstantIDModelLoader", inputs: { instantid_file: INSTANTID_DEFAULTS.instantidFile } },
    "21": { class_type: "InstantIDFaceAnalysis", inputs: { provider: "CPU" } },
    "22": { class_type: "ControlNetLoader", inputs: { control_net_name: INSTANTID_DEFAULTS.controlnetFile } },
    "23": {
      class_type: "ApplyInstantIDAdvanced",
      inputs: {
        instantid: ["20", 0], insightface: ["21", 0], control_net: ["22", 0], image: ["10", 0],
        // When a pose ControlNet block is present it feeds its model/conditioning
        // in via poseModelRef/posePositive/poseNegative; otherwise use the base nodes.
        model: a.poseModelRef ?? ["4", 0],
        positive: a.posePositive ?? ["6", 0],
        negative: a.poseNegative ?? ["7", 0],
        ip_weight: ipWeight, cn_strength: INSTANTID_DEFAULTS.cnStrength,
        start_at: 0.0, end_at: INSTANTID_DEFAULTS.endAt, noise: 0.0, combine_embeds: "average",
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: a.seed, steps: INSTANTID_DEFAULTS.steps, cfg: INSTANTID_DEFAULTS.cfg,
        sampler_name: INSTANTID_DEFAULTS.sampler, scheduler: INSTANTID_DEFAULTS.scheduler, denoise: 1,
        model: ["23", 0], positive: ["23", 1], negative: ["23", 2], latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  };
}
```

```ts
// backend/src/media/image/workflow/faceswap.ts
// PoppyFaceSwap (inswapper_128 + GPEN restore). gpenVisibility drops from 1.0 to
// ~0.6 under Fix 1. When the yaw gate is on and |yaw| >= threshold the swap is
// SKIPPED (identity carried by InstantID/PuLID), so the caller passes null.
export function faceSwapNode(a: { targetRef: [string, number]; gpenVisibility?: number }): Record<string, unknown> {
  return {
    "50": {
      class_type: "PoppyFaceSwap",
      inputs: {
        target_image: a.targetRef, source_image: ["10", 0],
        gpen_visibility: a.gpenVisibility ?? 1.0,
      },
    },
  };
}
```

```ts
// backend/src/media/image/workflow/assemble.ts
// Compose enabled blocks into one ComfyUI graph. All flags off => the exact
// current graph (VAEDecode -> PoppyFaceSwap -> SaveImage).
import { baseNodes } from "./base";
import { instantIdNodes } from "./instantid";
import { faceSwapNode } from "./faceswap";
import type { ImageWorkflowFlags } from "../flags";

export interface AssembleArgs {
  ckpt: string; positive: string; negative: string; refName: string; seed: number;
  flags: ImageWorkflowFlags; yawDeg?: number; poseSkeletonName?: string; ipWeight?: number;
  gpenVisibility?: number;
}

export function assembleConsistentWorkflow(a: AssembleArgs): Record<string, unknown> {
  const g: Record<string, unknown> = {
    ...baseNodes({ ckpt: a.ckpt, positive: a.positive, negative: a.negative }),
    ...instantIdNodes({ refName: a.refName, seed: a.seed, ipWeight: a.ipWeight }),
  };
  // Terminal image node: starts as the VAEDecode (node 8). Each block that adds
  // a post-process node advances this reference. SaveImage consumes whatever the
  // last block produced.
  let lastImage: [string, number] = ["8", 0];

  // Fix 2 yaw gate decides whether to run inswapper. Default (gate off) => run it.
  const skipSwap = a.flags.yawGate && (a.yawDeg ?? 0) >= 30;
  if (!skipSwap) {
    Object.assign(g, faceSwapNode({ targetRef: lastImage, gpenVisibility: a.gpenVisibility }));
    lastImage = ["50", 0];
  }

  g["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "poppy-chat", images: lastImage } };
  return g;
}
```

Then in `providers.ts`, replace the body of `buildInstantIdWorkflow` with a call to `assembleConsistentWorkflow` (all flags off preserves current output), and thread `resolveImageFlags()` through `generateWithComfyUIConsistent`. Keep the `positive`/`negative`/`pose` string assembly exactly as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/media/image/flags.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS. Then `npx tsc -p backend --noEmit` to confirm `providers.ts` still compiles.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/image/flags.ts backend/src/media/image/workflow/ backend/src/media/image/providers.ts backend/src/media/image/flags.test.ts
git commit -m "refactor(image): split consistent workflow into flag-gated blocks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix 1 - FaceDetailer block (flag IMG_FACEDETAILER)

Insert a FaceDetailer node AFTER PoppyFaceSwap at low denoise to sharpen the tiny swapped face without regenerating identity; lower GPEN visibility to 0.6.

**Files:**
- Create: `backend/src/media/image/workflow/facedetailer.ts`
- Modify: `backend/src/media/image/workflow/assemble.ts`, `backend/src/media/image/constants.ts`
- Test: `backend/src/media/image/workflow/facedetailer.test.ts`

**Interfaces:**
- Produces: `faceDetailerNode(a: { inputImage: [string, number]; startNodeId: number }): Record<string, unknown>` returning the `UltralyticsDetectorProvider` + `FaceDetailer` nodes; assembler routes `lastImage` through it when `flags.faceDetailer`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/image/workflow/facedetailer.test.ts
import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

describe("FaceDetailer flag", () => {
  it("inserts FaceDetailer after faceswap and before SaveImage", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }) });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("FaceDetailer");
    const save = g["9"] as { inputs: { images: [string, number] } };
    const fdNodeId = Object.keys(g).find((k) => (g[k] as { class_type: string }).class_type === "FaceDetailer")!;
    expect(save.inputs.images[0]).toBe(fdNodeId); // SaveImage now consumes FaceDetailer
  });
  it("caps denoise at 0.35 to protect identity", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }) });
    const fd = Object.values(g).find((n) => (n as { class_type: string }).class_type === "FaceDetailer") as { inputs: { denoise: number } };
    expect(fd.inputs.denoise).toBeLessThanOrEqual(0.35);
  });
  it("lowers GPEN visibility when FaceDetailer is on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }), gpenVisibility: 0.6 });
    const swap = g["50"] as { inputs: { gpen_visibility: number } };
    expect(swap.inputs.gpen_visibility).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/image/workflow/facedetailer.test.ts`
Expected: FAIL, no `FaceDetailer` node emitted.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/image/workflow/facedetailer.ts
// FaceDetailer re-diffuses ONLY the detected face box at high res, low denoise,
// so a tiny far-from-camera face gets crisp without changing the person. Runs
// AFTER the swap. denoise is the identity valve: hard cap 0.35.
export const FACEDETAILER = {
  bboxModel: "face_yolov8m.pt", denoise: 0.25, guideSize: 768, maxSize: 1024,
  bboxCropFactor: 3.0, bboxDilation: 6, feather: 8, bboxThreshold: 0.45, steps: 24, cfg: 7,
} as const;
export function faceDetailerNodes(a: { inputImage: [string, number] }): { nodes: Record<string, unknown>; outId: string } {
  const nodes: Record<string, unknown> = {
    "70": { class_type: "UltralyticsDetectorProvider", inputs: { model_name: FACEDETAILER.bboxModel } },
    "71": {
      class_type: "FaceDetailer",
      inputs: {
        image: a.inputImage, model: ["4", 0], clip: ["4", 1], vae: ["4", 2],
        positive: ["6", 0], negative: ["7", 0], bbox_detector: ["70", 0],
        guide_size: FACEDETAILER.guideSize, guide_size_for: true, max_size: FACEDETAILER.maxSize,
        denoise: Math.min(0.35, FACEDETAILER.denoise), feather: FACEDETAILER.feather,
        bbox_threshold: FACEDETAILER.bboxThreshold, bbox_dilation: FACEDETAILER.bboxDilation,
        bbox_crop_factor: FACEDETAILER.bboxCropFactor, steps: FACEDETAILER.steps, cfg: FACEDETAILER.cfg,
        sampler_name: "dpmpp_2m", scheduler: "karras", seed: 0, noise_mask: true, force_inpaint: true, cycle: 1,
      },
    },
  };
  return { nodes, outId: "71" };
}
```

Update `assemble.ts` to, when `flags.faceDetailer`, default `gpenVisibility` to 0.6 and route `lastImage` through `faceDetailerNodes` before `SaveImage`:

```ts
// inside assembleConsistentWorkflow, after the faceswap block:
if (a.flags.faceDetailer) {
  const { faceDetailerNodes } = require("./facedetailer") as typeof import("./facedetailer");
  const fd = faceDetailerNodes({ inputImage: lastImage });
  Object.assign(g, fd.nodes);
  lastImage = [fd.outId, 0];
}
```

(Also pass `gpenVisibility: a.flags.faceDetailer ? (a.gpenVisibility ?? 0.6) : a.gpenVisibility` into the faceswap block.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/image/workflow/facedetailer.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS (all-off graph still matches Task 1's test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/image/workflow/facedetailer.ts backend/src/media/image/workflow/facedetailer.test.ts backend/src/media/image/workflow/assemble.ts backend/src/media/image/constants.ts
git commit -m "feat(image): FaceDetailer block behind IMG_FACEDETAILER (sharpen tiny faces)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Fix 3 - Hand detailer block (flag IMG_HAND_DETAILER)

A hands-only YOLO DetailerForEach that runs LAST. Hand SEGS never include the face, so identity is safe by construction.

**Files:**
- Create: `backend/src/media/image/workflow/handdetailer.ts`
- Modify: `backend/src/media/image/workflow/assemble.ts`
- Test: `backend/src/media/image/workflow/handdetailer.test.ts`

**Interfaces:**
- Produces: `handDetailerNodes(a: { inputImage: [string, number] }): { nodes; outId }` using `hand_yolov9c.pt`, denoise 0.5, dilation 10-20. Assembler routes `lastImage` through it LAST when `flags.handDetailer`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/image/workflow/handdetailer.test.ts
import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";
const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

describe("Hand detailer flag", () => {
  it("adds a hand detailer and runs it last (SaveImage consumes it)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true, handDetailer: true }) });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("DetailerForEach");
    const hdId = Object.keys(g).find((k) => (g[k] as { class_type: string }).class_type === "DetailerForEach")!;
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images[0]).toBe(hdId);
  });
  it("uses a hand model, not a face model", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ handDetailer: true }) });
    const provider = Object.values(g).find((n) => (n as { class_type: string; inputs?: { model_name?: string } }).inputs?.model_name?.includes("hand")) as { inputs: { model_name: string } };
    expect(provider.inputs.model_name).toMatch(/hand/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/image/workflow/handdetailer.test.ts`
Expected: FAIL, no `DetailerForEach`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/image/workflow/handdetailer.ts
// Hands-only detailer. Detect hands (YOLO) -> SEGS -> DetailerForEach re-diffuses
// each hand crop at higher denoise to rebuild fingers. Never touches the face.
export const HANDDETAILER = { bboxModel: "hand_yolov9c.pt", denoise: 0.5, dilation: 16, cropFactor: 3.0, feather: 8, threshold: 0.4, guideSize: 768 } as const;
export function handDetailerNodes(a: { inputImage: [string, number] }): { nodes: Record<string, unknown>; outId: string } {
  const nodes: Record<string, unknown> = {
    "80": { class_type: "UltralyticsDetectorProvider", inputs: { model_name: HANDDETAILER.bboxModel } },
    "81": { class_type: "BboxDetectorSEGS", inputs: { bbox_detector: ["80", 0], image: a.inputImage, threshold: HANDDETAILER.threshold, dilation: HANDDETAILER.dilation, crop_factor: HANDDETAILER.cropFactor } },
    "82": {
      class_type: "DetailerForEach",
      inputs: {
        image: a.inputImage, segs: ["81", 0], model: ["4", 0], clip: ["4", 1], vae: ["4", 2],
        positive: ["6", 0], negative: ["7", 0], guide_size: HANDDETAILER.guideSize, guide_size_for: true,
        max_size: 1024, denoise: HANDDETAILER.denoise, feather: HANDDETAILER.feather, steps: 24, cfg: 7,
        sampler_name: "dpmpp_2m", scheduler: "karras", seed: 0, noise_mask: true, force_inpaint: true, cycle: 1,
      },
    },
  };
  return { nodes, outId: "82" };
}
```

Update `assemble.ts` to route `lastImage` through the hand detailer LAST (after FaceDetailer) when `flags.handDetailer`, then `SaveImage` consumes it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/image/workflow/handdetailer.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/image/workflow/handdetailer.ts backend/src/media/image/workflow/handdetailer.test.ts backend/src/media/image/workflow/assemble.ts
git commit -m "feat(image): hand detailer block behind IMG_HAND_DETAILER

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix 4 - Body pose ControlNet, head kept free (flag IMG_POSE_CONTROLNET)

Add a real OpenPose ControlNet for the BODY only (head keypoints stripped) so specific poses render while the head stays free to rotate. Lower InstantID ip_weight to 0.75. Provide a curated pose-skeleton library keyed off user pose hints with fallback to the current text descriptors.

**Files:**
- Create: `backend/src/media/image/workflow/pose-controlnet.ts`, `backend/src/media/image/pose-library.ts`
- Modify: `backend/src/media/image/workflow/assemble.ts`, `backend/src/media/image/workflow/instantid.ts` (accept lowered ipWeight + pose model/conditioning refs)
- Test: `backend/src/media/image/workflow/pose-controlnet.test.ts`, `backend/src/media/image/pose-library.test.ts`

**Interfaces:**
- Produces: `poseControlNetNodes(a: { skeletonName?: string }): { nodes; modelRef; posRef; negRef }` (DWPreprocessor -> ultimate-openpose-editor show_face=false -> ControlNetLoader xinsir openpose-sdxl -> ControlNetApplyAdvanced str 0.6 end 0.6); `matchPoseSkeleton(text: string): string | null` (maps "sitting"/"lying"/"arms up" etc to a skeleton file, else null).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/image/pose-library.test.ts
import { describe, it, expect } from "vitest";
import { matchPoseSkeleton } from "./pose-library";
describe("matchPoseSkeleton", () => {
  it("maps known poses to skeleton files", () => {
    expect(matchPoseSkeleton("sitting on a couch")).toMatch(/sitting/);
    expect(matchPoseSkeleton("lying on the bed")).toMatch(/lying/);
  });
  it("returns null for an unknown pose", () => {
    expect(matchPoseSkeleton("just standing there")).toBeNull();
  });
});
```

```ts
// backend/src/media/image/workflow/pose-controlnet.test.ts
import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";
const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };
describe("Pose ControlNet flag", () => {
  it("adds an OpenPose ControlNet apply and strips the head (show_face=false)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ poseControlNet: true }), poseSkeletonName: "sitting.png" });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.some((c) => c.includes("ControlNetApply"))).toBe(true);
    const editor = Object.values(g).find((n) => (n as { class_type: string }).class_type.includes("OpenposeEditor")) as { inputs: { show_face: boolean } };
    expect(editor.inputs.show_face).toBe(false);
  });
  it("lowers InstantID ip_weight to 0.75 when pose control is on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ poseControlNet: true }), poseSkeletonName: "sitting.png" });
    expect((g["23"] as { inputs: { ip_weight: number } }).inputs.ip_weight).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/media/image/pose-library.test.ts backend/src/media/image/workflow/pose-controlnet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/image/pose-library.ts
// Map a free-text pose hint to a curated OpenPose skeleton PNG uploaded to the
// ComfyUI input dir. Returns null to fall back to the text-descriptor path.
const POSE_MAP: Array<{ re: RegExp; file: string }> = [
  { re: /\bsit(ting)?\b/i, file: "pose-sitting.png" },
  { re: /\bl(y|ie)ing|lay(ing)?\b/i, file: "pose-lying.png" },
  { re: /\barms? up|reaching|stretch/i, file: "pose-arms-up.png" },
  { re: /\bkneel/i, file: "pose-kneeling.png" },
];
export function matchPoseSkeleton(text: string): string | null {
  for (const p of POSE_MAP) if (p.re.test(text)) return p.file;
  return null;
}
```

```ts
// backend/src/media/image/workflow/pose-controlnet.ts
// Body OpenPose ControlNet with the head freed. DWPose -> ultimate-openpose-editor
// (show_face=false strips head keypoints) -> xinsir openpose-sdxl -> apply at
// strength 0.6, end 0.6 so late steps release the face for InstantID.
export const POSE = { controlnet: "controlnet-openpose-sdxl-1.0.safetensors", strength: 0.6, endPercent: 0.6 } as const;
export function poseControlNetNodes(a: { skeletonName: string }): {
  nodes: Record<string, unknown>; modelRef: [string, number]; posRef: [string, number]; negRef: [string, number];
} {
  const nodes: Record<string, unknown> = {
    "90": { class_type: "LoadImage", inputs: { image: a.skeletonName } },
    "91": { class_type: "DWPreprocessor", inputs: { image: ["90", 0], detect_body: "enable", detect_hand: "enable", detect_face: "disable", resolution: 1024 } },
    "92": { class_type: "OpenposeEditorNode", inputs: { pose_kps: ["91", 1], show_body: true, show_hands: true, show_face: false } },
    "93": { class_type: "ControlNetLoader", inputs: { control_net_name: POSE.controlnet } },
    "94": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["6", 0], negative: ["7", 0], control_net: ["93", 0], image: ["92", 0],
        strength: POSE.strength, start_percent: 0.0, end_percent: POSE.endPercent, vae: ["4", 2],
      },
    },
  };
  // The pose block owns the conditioning that InstantID consumes; model stays base.
  return { nodes, modelRef: ["4", 0], posRef: ["94", 0], negRef: ["94", 1] };
}
```

Update `assemble.ts`: when `flags.poseControlNet` and a `poseSkeletonName` is present, add the pose nodes, pass `ipWeight: 0.75` and the pose `modelRef/posRef/negRef` into `instantIdNodes`. When no skeleton matches, do NOT add the block (fall back to the text-descriptor pose that `providers.ts` already prepends).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/media/image/pose-library.test.ts backend/src/media/image/workflow/pose-controlnet.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/image/pose-library.ts backend/src/media/image/workflow/pose-controlnet.ts backend/src/media/image/workflow/instantid.ts backend/src/media/image/workflow/assemble.ts backend/src/media/image/pose-library.test.ts backend/src/media/image/workflow/pose-controlnet.test.ts
git commit -m "feat(image): body OpenPose ControlNet with free head behind IMG_POSE_CONTROLNET

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fix 2 - Yaw-gated identity (flags IMG_YAW_GATE / IMG_PULID)

Estimate head yaw. Below 30 degrees keep inswapper_128 (best frontal signal). At/above 30 skip inswapper and carry identity with PuLID-SDXL so angled heads do not shear.

**Files:**
- Create: `backend/src/media/image/workflow/pulid.ts`, `backend/src/media/image/yaw.ts`
- Modify: `backend/src/media/image/workflow/assemble.ts` (branch on yaw), `backend/src/media/image/providers.ts` (compute yaw from the pose hint / reference, pass `yawDeg`)
- Test: `backend/src/media/image/yaw.test.ts`, `backend/src/media/image/workflow/pulid.test.ts`

**Interfaces:**
- Produces: `estimateYawFromPoseHint(hint: string): number` (maps "three-quarter"/"over shoulder"/"profile" descriptors to a degree estimate; frontal = 0); `pulidNodes(a): { nodes; outModelRef }` (PuLID-SDXL identity conditioning applied to the model). Assembler: when `flags.yawGate` and yaw >= 30, skip faceswap (already handled in Task 1) and, when `flags.pulid`, insert PuLID conditioning on the model feeding the KSampler.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/image/yaw.test.ts
import { describe, it, expect } from "vitest";
import { estimateYawFromPoseHint } from "./yaw";
describe("estimateYawFromPoseHint", () => {
  it("frontal descriptors are ~0 deg", () => {
    expect(estimateYawFromPoseHint("looking directly at camera")).toBeLessThan(15);
  });
  it("three-quarter and over-shoulder exceed the 30 deg gate", () => {
    expect(estimateYawFromPoseHint("three-quarter view turning right")).toBeGreaterThanOrEqual(30);
    expect(estimateYawFromPoseHint("glancing over shoulder")).toBeGreaterThanOrEqual(30);
  });
});
```

```ts
// backend/src/media/image/workflow/pulid.test.ts
import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";
const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };
describe("yaw gate + PuLID", () => {
  it("skips faceswap when yaw >= 30 and gate on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ yawGate: true }), yawDeg: 40 });
    expect(g["50"]).toBeUndefined(); // no PoppyFaceSwap
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["8", 0]);
  });
  it("keeps faceswap when yaw < 30 even with gate on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ yawGate: true }), yawDeg: 10 });
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
  });
  it("inserts PuLID conditioning when pulid flag on and yaw high", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ yawGate: true, pulid: true }), yawDeg: 40 });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.some((c) => c.includes("PuLID"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/media/image/yaw.test.ts backend/src/media/image/workflow/pulid.test.ts`
Expected: FAIL (the yaw-skip in Task 1 handles the first two once `yaw.ts` + assembler branch exist; PuLID node missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/image/yaw.ts
// Estimate head yaw (degrees) from the pose descriptor the caller prepends. This
// avoids a separate detector pass; the descriptors are a closed set (see
// POSE_DESCRIPTORS in providers.ts). Frontal = 0; profile-ish >= 30.
const YAW_HINTS: Array<{ re: RegExp; deg: number }> = [
  { re: /directly at camera|front|facing/i, deg: 0 },
  { re: /slightly to the (left|right)/i, deg: 15 },
  { re: /three-?quarter/i, deg: 35 },
  { re: /over(\s|-)shoulder|glancing/i, deg: 55 },
  { re: /profile|side view/i, deg: 80 },
];
export function estimateYawFromPoseHint(hint: string): number {
  let max = 0;
  for (const h of YAW_HINTS) if (h.re.test(hint)) max = Math.max(max, h.deg);
  return max;
}
```

```ts
// backend/src/media/image/workflow/pulid.ts
// PuLID-SDXL conditions the diffusion model with the reference identity (unlike
// inswapper's pixel paste), so it follows head rotation. Used only on the angled
// branch. Applied to the base model before InstantID/KSampler consume it.
export function pulidNodes(a: { refNodeId: string }): { nodes: Record<string, unknown>; outModelRef: [string, number] } {
  const nodes: Record<string, unknown> = {
    "60": { class_type: "PulidModelLoader", inputs: { pulid_file: "ip-adapter_pulid_sdxl_fp16.safetensors" } },
    "61": { class_type: "PulidInsightFaceLoader", inputs: { provider: "CPU" } },
    "62": { class_type: "PulidEvaClipLoader", inputs: {} },
    "63": {
      class_type: "ApplyPulid",
      inputs: { model: ["4", 0], pulid: ["60", 0], eva_clip: ["62", 0], face_analysis: ["61", 0], image: [a.refNodeId, 0], weight: 0.9, start_at: 0.0, end_at: 1.0 },
    },
  };
  return { nodes, outModelRef: ["63", 0] };
}
```

Update `assemble.ts`: when `flags.yawGate && yawDeg >= 30 && flags.pulid`, add `pulidNodes({ refNodeId: "10" })` and pass its `outModelRef` into `instantIdNodes` as the KSampler model source. Then in `providers.ts`, compute `yawDeg = estimateYawFromPoseHint(pose)` and pass it to the assembler.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/media/image/yaw.test.ts backend/src/media/image/workflow/pulid.test.ts backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/image/yaw.ts backend/src/media/image/workflow/pulid.ts backend/src/media/image/workflow/assemble.ts backend/src/media/image/providers.ts backend/src/media/image/yaw.test.ts backend/src/media/image/workflow/pulid.test.ts
git commit -m "feat(image): yaw-gated identity (inswapper frontal, PuLID for angles)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: GPU box provisioning (additive) - APPROVAL-GATED to run

Add the new custom nodes + model files to the known-good box's `user-data.sh`. Additive only. Must NOT alter the Stheno or Juggernaut services. Runtime fallback: if a node/model is missing, `assemble.ts` falls back to the current graph and logs (add this guard).

**Files:**
- Modify: `Plans/inference-aws/user-data.sh` (ComfyUI custom-node install + model download section only)
- Modify: `backend/src/media/image/workflow/assemble.ts` (missing-capability fallback + log)
- Test: `backend/src/media/image/workflow/assemble.test.ts` (add a fallback case)

- [ ] **Step 1: Add a failing fallback test**

```ts
// append to assemble.test.ts
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";
it("falls back to the current graph when a capability is marked unavailable", () => {
  const g = assembleConsistentWorkflow({
    ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1,
    flags: resolveImageFlags({ faceDetailer: true }),
    availableNodes: new Set<string>(), // nothing available -> no FaceDetailer
  } as never);
  const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
  expect(classes).not.toContain("FaceDetailer");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/media/image/workflow/assemble.test.ts`
Expected: FAIL (assembler ignores `availableNodes`).

- [ ] **Step 3: Implement the fallback + user-data additions**

In `assemble.ts`, accept an optional `availableNodes?: Set<string>`; before adding each block, if `availableNodes` is provided and does not contain the block's key node class, skip the block and `logWarn`. In `Plans/inference-aws/user-data.sh`, in the ComfyUI custom-node clone section, add (idempotent `git clone` + `pip install -r requirements.txt`): `ComfyUI-Impact-Subpack`, `ComfyUI-ultimate-openpose-editor`, `ComfyUI_PuLID`, and (if not present) `comfyui_controlnet_aux`. In the model-download section add downloads to the correct subdirs: `face_yolov8m.pt`, `hand_yolov9c.pt` -> `models/ultralytics/bbox/`; `controlnet-openpose-sdxl-1.0.safetensors` -> `models/controlnet/`; PuLID-SDXL weights -> `models/pulid/`. Do NOT touch the Stheno service block or the existing Juggernaut model download.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/media/image/workflow/assemble.test.ts`
Expected: PASS. Then `bash -n Plans/inference-aws/user-data.sh` to syntax-check the shell.

- [ ] **Step 5: Commit (no box redeploy)**

```bash
git add Plans/inference-aws/user-data.sh backend/src/media/image/workflow/assemble.ts backend/src/media/image/workflow/assemble.test.ts
git commit -m "feat(image): additive box nodes/models + missing-capability fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: APPROVAL-GATED box redeploy.** ASK THE USER before redeploying the known-good box. The redeploy re-runs `user-data.sh`; verify afterward that `:8001/v1/models` (Stheno) and `:8188/system_stats` (Juggernaut) still respond and the new nodes appear in `:8188/object_info`.

---

## Task 7: Before/after quality harness + identity-regression gate

The numeric "do not disturb" gate. Generates BEFORE (all flags off) vs AFTER (each flag) on a fixed reference + seed across a fixed prompt set, writes a side-by-side contact sheet, and computes ArcFace cosine similarity so a flag that lowers mean identity similarity is rejected.

**Files:**
- Create: `backend/scripts/image-quality-harness.ts`
- Test: `backend/scripts/__tests__/image-quality-harness.test.ts`

**Interfaces:**
- Produces: `compareSimilarity(before: number[], after: number[]): { beforeMean: number; afterMean: number; regressed: boolean }` (regressed = afterMean < beforeMean); a CLI `runHarness()` that iterates the prompt set (frontal, three-quarter, over-shoulder, sitting, arms up, lying), calls `generateWithComfyUIConsistent` with each flag combo, saves outputs, and prints the similarity table.

- [ ] **Step 1: Write the failing test (pure gate function)**

```ts
// backend/scripts/__tests__/image-quality-harness.test.ts
import { describe, it, expect } from "vitest";
import { compareSimilarity } from "../image-quality-harness";
describe("compareSimilarity gate", () => {
  it("flags a regression when after is lower", () => {
    const r = compareSimilarity([0.9, 0.9], [0.8, 0.85]);
    expect(r.regressed).toBe(true);
  });
  it("passes when after is equal or higher", () => {
    const r = compareSimilarity([0.9, 0.9], [0.91, 0.9]);
    expect(r.regressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/scripts/__tests__/image-quality-harness.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the gate + CLI**

```ts
// backend/scripts/image-quality-harness.ts
export function compareSimilarity(before: number[], after: number[]): { beforeMean: number; afterMean: number; regressed: boolean } {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const beforeMean = mean(before);
  const afterMean = mean(after);
  return { beforeMean, afterMean, regressed: afterMean < beforeMean };
}
// runHarness(): iterate the fixed prompt set + flag combos, call
// generateWithComfyUIConsistent, save PNGs to an output dir, compute ArcFace
// similarity per output vs the reference (via the box InstantIDFaceAnalysis or a
// local insightface), and print a table. Invoked manually against a live box.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/scripts/__tests__/image-quality-harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/image-quality-harness.ts backend/scripts/__tests__/image-quality-harness.test.ts
git commit -m "feat(image): before/after harness + ArcFace identity-regression gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Validation run (manual, needs the redeployed box).** With the box up (Task 6 approved), run the harness for each flag in rollout order (FaceDetailer -> hand detailer -> pose ControlNet -> yaw-gate). Keep a flag enabled in prod env ONLY if its contact sheet clearly improves the target problem AND `regressed === false`. Report the table to the user before enabling any flag in a hosted environment (that env change is a separate approval-gated deploy).

---

## Self-Review

**Spec coverage:** Refactor into flag-gated blocks (Task 1); Fix 1 FaceDetailer + GPEN 0.6 (Task 2); Fix 3 hand detailer last (Task 3); Fix 4 body pose ControlNet with head stripped + ip_weight 0.75 + pose library (Task 4); Fix 2 yaw-gate + PuLID (Task 5); additive box provisioning + runtime fallback (Task 6); before/after harness + numeric ArcFace gate (Task 7); A/B flags default OFF, staged rollout lowest-risk-first (Tasks 1-5 order); do-not-disturb constraint enforced numerically (Task 7 gate). All spec sections map to a task.

**Placeholder scan:** No "TBD"/"TODO". `runHarness()` body is described as a manual CLI around the tested pure `compareSimilarity` gate (the testable unit has real code + tests); the GPU-dependent parts are explicitly manual/approval-gated, not vague.

**Type consistency:** `ImageWorkflowFlags` (Task 1) is consumed unchanged by every block task; `assembleConsistentWorkflow` `AssembleArgs` gains `yawDeg`, `poseSkeletonName`, `ipWeight`, `gpenVisibility`, `availableNodes` across Tasks 1/2/4/5/6 with consistent names; block builders return `{ nodes, outId }` (detailers) or `{ nodes, modelRef/posRef/negRef }` (pose) or `{ nodes, outModelRef }` (pulid) and the assembler wires them by those exact names; node ids are unique across blocks (base 3-9, instantid 10/20-23, faceswap 50, pulid 60-63, detailer face 70-71, hand 80-82, pose 90-94).

## Execution Handoff

Handoff options are presented by the orchestrator after both plans are reviewed.
