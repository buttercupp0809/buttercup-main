# Video Quality and Prompt Adherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make i2v reels obey the typed prompt (outfit/scene), play smoothly (32fps), and support 3/5/8s.

**Architecture:** Three-stage self-hosted i2v pipeline: (A) restyle a new first frame via the existing SDXL InstantID identity pipeline so frame 0 already shows the requested outfit/scene; (B) Wan 2.2 i2v with the 3-sampler motion pattern (no Lightning LoRA on the high-noise expert) at a higher resolution; (C) RIFE 2x frame interpolation to 32fps. A per-video Transform/Keep toggle chooses whether Stage A runs.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, zod, ComfyUI (Wan 2.2 A14B + RIFE VFI), vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-video-quality-and-prompt-adherence-design.md`

## Global Constraints

- Prisma singleton only: `import { prisma } from "@buttercupp/database"`. Never `new PrismaClient()`.
- No em dash (U+2014) anywhere. Use commas/periods/parentheses.
- `zod` validates every mutation at the trust boundary.
- Do NOT commit, push, or deploy. Leave changes in the working tree for human review. (Overrides the SDD template's per-task commit step: make the edits and run tests, but skip `git commit`.)
- All changes are behind the self-hosted Wan path; the cloud fallback (Fal/Replicate) and the dev stub-clip path must keep working when the box is down.
- Stage C (RIFE) is gated behind an env flag defaulting OFF, because the box needs the RIFE custom node installed first.
- `buildWanWorkflow` stays a pure function (no I/O, no env reads); env gating is computed by the caller and passed in.

---

### Task 1: Add `sceneMode` to the video payload schema

**Files:**
- Modify: `packages/shared/src/media.ts:98-104` (`createVideoPayloadSchema`)
- Test: `packages/shared` test file next to the existing media schema tests (find with `grep -rl createVideoPayloadSchema packages/shared` for the existing test location; if none, create `packages/shared/src/media.test.ts`).

**Interfaces:**
- Produces: `CreateVideoPayload.sceneMode: "transform" | "keep"` (default `"transform"`). Consumed by Task 5 (handler) and Task 6 (frontend).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createVideoPayloadSchema } from "./media";

describe("createVideoPayloadSchema sceneMode", () => {
  it("defaults sceneMode to transform", () => {
    const p = createVideoPayloadSchema.parse({ userRequest: "on a beach" });
    expect(p.sceneMode).toBe("transform");
  });
  it("accepts keep and rejects unknown", () => {
    expect(createVideoPayloadSchema.parse({ userRequest: "x", sceneMode: "keep" }).sceneMode).toBe("keep");
    expect(() => createVideoPayloadSchema.parse({ userRequest: "x", sceneMode: "nope" })).toThrow();
  });
  it("accepts 8 second duration", () => {
    expect(createVideoPayloadSchema.parse({ userRequest: "x", seconds: 8 }).seconds).toBe(8);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (`sceneMode` undefined). `npx vitest run packages/shared/src/media.test.ts`
- [ ] **Step 3: Add the field**

```ts
export const createVideoPayloadSchema = z.object({
  userRequest: z.string().max(2000),
  mode: z.enum(["i2v"]).default("i2v"),
  seconds: z.number().int().min(1).max(10).default(5),
  aspectRatio: z.enum(["portrait", "landscape", "square"]).default("portrait"),
  quality: z.enum(["fast", "balanced", "max"]).default("balanced"),
  // "transform" restyles a new first frame from the prompt (outfit/scene change);
  // "keep" animates the character's real photo (motion-only).
  sceneMode: z.enum(["transform", "keep"]).default("transform"),
});
```

- [ ] **Step 4: Run tests, verify pass.** Also `npm run typecheck` in `packages/shared`.

---

### Task 2: Rework Wan presets, add interpolation config + HQ resolution

**Files:**
- Modify: `backend/src/media/video/constants.ts`
- Test: `backend/src/media/video/constants.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `WAN_STEPS[preset].interpolate: boolean` and `WAN_STEPS[preset].hq: boolean` on every preset entry (in addition to the existing `high`/`low`).
  - `VIDEO_ASPECTS_HQ: Record<VideoAspect, {width,height}>` (576p-class, dims divisible by 16).
  - `RIFE_MULTIPLIER = 2`, `RIFE_CKPT = "rife49.pth"`, `interpolatedFps(): number` = `WAN_FPS * RIFE_MULTIPLIER` (32).
  - `videoInterpolationEnabled(): boolean` = `process.env.WAN_INTERPOLATION === "1"`.
  - Consumed by Task 3 (workflow) and Task 5 (providers/handler).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { WAN_STEPS, VIDEO_ASPECTS_HQ, RIFE_MULTIPLIER, interpolatedFps, WAN_FPS } from "./constants";

describe("wan presets v2", () => {
  it("high-noise expert drops the Lightning LoRA on balanced and max", () => {
    expect(WAN_STEPS.balanced.high.lora).toBe(false);
    expect(WAN_STEPS.max.high.lora).toBe(false);
    expect(WAN_STEPS.fast.high.lora).toBe(true);
  });
  it("interpolation on for balanced/max, off for fast", () => {
    expect(WAN_STEPS.balanced.interpolate).toBe(true);
    expect(WAN_STEPS.max.interpolate).toBe(true);
    expect(WAN_STEPS.fast.interpolate).toBe(false);
  });
  it("hq resolution on for balanced/max", () => {
    expect(WAN_STEPS.balanced.hq).toBe(true);
    expect(WAN_STEPS.fast.hq).toBe(false);
  });
  it("interpolated fps doubles native", () => {
    expect(interpolatedFps()).toBe(WAN_FPS * RIFE_MULTIPLIER);
    expect(RIFE_MULTIPLIER).toBe(2);
  });
  it("hq aspects are divisible by 16", () => {
    for (const a of Object.values(VIDEO_ASPECTS_HQ)) {
      expect(a.width % 16).toBe(0);
      expect(a.height % 16).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Replace `WAN_STEPS` and add the new exports:

```ts
// Per-expert sampling + post-processing per preset. The high-noise expert is the
// "motion director": keeping the Lightning LoRA off it (balanced/max) is what
// restores real motion (the LoRA there flattens motion into a slideshow). The
// low-noise expert keeps the LoRA at cfg 1 for speed. `interpolate` adds RIFE 2x
// (Stage C); `hq` renders at the 576p-class VIDEO_ASPECTS_HQ for cleaner motion.
export const WAN_STEPS = {
  fast: {
    high: { steps: 4, cfg: 1.0, lora: true },
    low: { steps: 4, cfg: 1.0, lora: true },
    interpolate: false,
    hq: false,
  },
  balanced: {
    high: { steps: 6, cfg: 4.0, lora: false },
    low: { steps: 4, cfg: 1.0, lora: true },
    interpolate: true,
    hq: true,
  },
  max: {
    high: { steps: 10, cfg: 4.0, lora: false },
    low: { steps: 8, cfg: 3.5, lora: false },
    interpolate: true,
    hq: true,
  },
} as const;

// 576p-class dims (all divisible by 16). Used by hq presets for better motion;
// fast keeps the lighter VIDEO_ASPECTS (480p) for speed.
export const VIDEO_ASPECTS_HQ = {
  portrait: { width: 576, height: 1024 },
  landscape: { width: 1024, height: 576 },
  square: { width: 768, height: 768 },
} as const;

// RIFE frame interpolation (Stage C). rife49.pth ships with
// ComfyUI-Frame-Interpolation; the box must have that custom node installed
// before WAN_INTERPOLATION=1 is set (see Plans/inference-video-aws).
export const RIFE_MULTIPLIER = 2;
export const RIFE_CKPT = "rife49.pth";
export function interpolatedFps(): number {
  return WAN_FPS * RIFE_MULTIPLIER;
}
export function videoInterpolationEnabled(): boolean {
  return process.env.WAN_INTERPOLATION === "1";
}
```

- [ ] **Step 4: Run tests + `npm run typecheck` in backend.** Keep `WanPreset`, `WAN_DEFAULT_PRESET`, `WAN_SHIFT` as-is.

---

### Task 3: Add RIFE node + HQ resolution to the Wan workflow

**Files:**
- Modify: `backend/src/media/video/workflow.ts`
- Test: `backend/src/media/video/workflow.test.ts` (extend existing; find with `grep -rl buildWanWorkflow backend/src/media/video`)

**Interfaces:**
- Consumes: `WAN_STEPS[preset].hq/interpolate`, `VIDEO_ASPECTS_HQ`, `RIFE_CKPT`, `RIFE_MULTIPLIER`, `interpolatedFps` from Task 2.
- Produces: `WanWorkflowArgs.interpolate: boolean` (new field; caller passes `WAN_STEPS[preset].interpolate && videoInterpolationEnabled()`).

- [ ] **Step 1: Write failing tests** (assert graph structure, not the box):

```ts
// balanced + interpolate => a "RIFE VFI" node sits between VAEDecode(60) and SaveWEBM,
// and SaveWEBM reads from it at 32fps.
it("inserts RIFE and saves at 32fps when interpolate is true", () => {
  const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "balanced", refImageName: "r.png", interpolate: true }) as Record<string, any>;
  const rife = Object.values(g).find((n: any) => n.class_type === "RIFE VFI") as any;
  expect(rife).toBeTruthy();
  expect(rife.inputs.frames).toEqual(["60", 0]);
  expect(rife.inputs.ckpt_name).toBe("rife49.pth");
  expect(rife.inputs.multiplier).toBe(2);
  const save = Object.values(g).find((n: any) => n.class_type === "SaveWEBM") as any;
  expect(save.inputs.fps).toBe(32);
  // SaveWEBM reads from the RIFE node, not the decoder.
  const rifeId = Object.keys(g).find((k) => g[k].class_type === "RIFE VFI");
  expect(save.inputs.images[0]).toBe(rifeId);
});

it("no RIFE and 16fps when interpolate is false (fast)", () => {
  const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "fast", refImageName: "r.png", interpolate: false }) as Record<string, any>;
  expect(Object.values(g).some((n: any) => n.class_type === "RIFE VFI")).toBe(false);
  const save = Object.values(g).find((n: any) => n.class_type === "SaveWEBM") as any;
  expect(save.inputs.fps).toBe(16);
  expect(save.inputs.images).toEqual(["60", 0]);
});

it("uses HQ dims for hq presets", () => {
  const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "balanced", refImageName: "r.png", interpolate: true }) as Record<string, any>;
  const i2v = Object.values(g).find((n: any) => n.class_type === "WanImageToVideo") as any;
  expect(i2v.inputs.width).toBe(576);
  expect(i2v.inputs.height).toBe(1024);
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
  - Add `interpolate: boolean` to `WanWorkflowArgs`.
  - Choose dims: `const size = WAN_STEPS[a.preset].hq ? VIDEO_ASPECTS_HQ[a.aspect] : VIDEO_ASPECTS[a.aspect];` (import `WAN_STEPS`, `VIDEO_ASPECTS_HQ`, `RIFE_CKPT`, `RIFE_MULTIPLIER`, `interpolatedFps`).
  - After node `"60"` (VAEDecode), if `a.interpolate`, add:

```ts
g["62"] = {
  class_type: "RIFE VFI",
  inputs: {
    frames: ["60", 0],
    ckpt_name: RIFE_CKPT,
    clear_cache_after_n_frames: 10,
    multiplier: RIFE_MULTIPLIER,
    fast_mode: true,
    ensemble: true,
    scale_factor: 1.0,
  },
};
```
  - Point SaveWEBM at the RIFE output and set fps accordingly:

```ts
const framesSource: [string, number] = a.interpolate ? ["62", 0] : ["60", 0];
const outFps = a.interpolate ? interpolatedFps() : WAN_FPS;
g["61"] = {
  class_type: "SaveWEBM",
  inputs: { images: framesSource, filename_prefix: "poppy-wan", codec: "vp9", fps: outFps, crf: 19 },
};
```
  - Keep the note comment at the top of the file (RIFE VFI class_type must be confirmed on the box).

- [ ] **Step 4: Run tests + backend typecheck.**

---

### Task 4: `restyleFirstFrame` (Stage A)

**Files:**
- Create: `backend/src/media/video/restyle.ts`
- Test: `backend/src/media/video/restyle.test.ts`

**Interfaces:**
- Consumes: `resolveCharacterReferenceBytes` (`../reference`), `generateWithComfyUIConsistent` (`../image/providers`), `buildImagePrompt` (`../image/prompt` — read that file for its exact signature; mirror how `handlers/image.ts` builds a prompt from the character's `currentVersion.appearanceSheet`), `prisma`.
- Produces: `restyleFirstFrame(args: { characterId: string; userRequest: string; aspect: VideoAspect }): Promise<Buffer | null>`. Consumed by Task 5.

Behavior: resolve the character's real reference bytes; if null, return null. Load the character + appearanceSheet; build an IMAGE prompt (identity fragment for face consistency + `userRequest` as the scene/outfit directive) and negative. Call `generateWithComfyUIConsistent({ prompt, negativePrompt, referenceBytes })` and return `res.buffer`. Catch ALL errors and return null (caller falls back to the raw photo). The `aspect` arg is accepted for parity/logging; the image pipeline's own sizing governs the still.

- [ ] **Step 1: Write failing tests** (mock the two collaborators + prisma):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../reference", () => ({ resolveCharacterReferenceBytes: vi.fn() }));
vi.mock("../image/providers", () => ({ generateWithComfyUIConsistent: vi.fn() }));
vi.mock("@buttercupp/database", () => ({
  prisma: { character: { findUnique: vi.fn() } },
}));

import { resolveCharacterReferenceBytes } from "../reference";
import { generateWithComfyUIConsistent } from "../image/providers";
import { prisma } from "@buttercupp/database";
import { restyleFirstFrame } from "./restyle";

const sheet = { stylePrompt: "s", negativePrompt: "n", traits: {} };
const char = { style: "realistic", currentVersion: { appearanceSheet: sheet } };

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.character.findUnique as any).mockResolvedValue(char);
});

it("returns the restyled buffer on success", async () => {
  (resolveCharacterReferenceBytes as any).mockResolvedValue(Buffer.from("ref"));
  (generateWithComfyUIConsistent as any).mockResolvedValue({ buffer: Buffer.from("newframe"), provider: "comfyui", meta: {} });
  const out = await restyleFirstFrame({ characterId: "c1", userRequest: "blue dress on a beach", aspect: "portrait" });
  expect(out?.toString()).toBe("newframe");
});

it("returns null when there is no reference image", async () => {
  (resolveCharacterReferenceBytes as any).mockResolvedValue(null);
  expect(await restyleFirstFrame({ characterId: "c1", userRequest: "x", aspect: "portrait" })).toBeNull();
});

it("returns null when generation throws (caller falls back to raw photo)", async () => {
  (resolveCharacterReferenceBytes as any).mockResolvedValue(Buffer.from("ref"));
  (generateWithComfyUIConsistent as any).mockRejectedValue(new Error("box down"));
  expect(await restyleFirstFrame({ characterId: "c1", userRequest: "x", aspect: "portrait" })).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `restyle.ts`.** Wrap the whole body in try/catch returning null. Build the prompt from the appearance sheet (reuse `buildImagePrompt` if its shape fits; otherwise assemble identity traits + `userRequest` inline, matching `image/prompt.ts` conventions). Log a warn on failure via `../utils/log`.
- [ ] **Step 4: Run tests + backend typecheck.**

---

### Task 5: Wire Stage A into the handler + thread interpolate through providers

**Files:**
- Modify: `backend/src/media/handlers/video.ts`
- Modify: `backend/src/media/video/providers.ts` (compute `interpolate` and pass to `buildWanWorkflow`)
- Test: extend `backend/src/media/handlers/video.test.ts` (find/create)

**Interfaces:**
- Consumes: `restyleFirstFrame` (Task 4), `sceneMode` (Task 1), `WAN_STEPS`/`videoInterpolationEnabled` (Task 2), `WanWorkflowArgs.interpolate` (Task 3).

- [ ] **Step 1: Write failing tests** — with the box unconfigured the handler still takes the stub path, so test the branch logic by asserting: (a) on `sceneMode:"transform"` the handler calls `restyleFirstFrame`; (b) when restyle returns null it falls back to `resolveCharacterReferenceBytes`; (c) on `sceneMode:"keep"` it does NOT call `restyleFirstFrame`. Mock `restyleFirstFrame` and `resolveCharacterReferenceBytes`. Assert `meta.sceneMode` and `meta.restyle`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** In `handlers/video.ts`:

```ts
let referenceBytes: Buffer | null;
let restyle: "applied" | "failed" | "skipped";
if (input.sceneMode === "transform") {
  referenceBytes = await restyleFirstFrame({ characterId: job.characterId, userRequest, aspect });
  if (referenceBytes) {
    restyle = "applied";
  } else {
    referenceBytes = await resolveCharacterReferenceBytes(job.characterId);
    restyle = "failed";
  }
} else {
  referenceBytes = await resolveCharacterReferenceBytes(job.characterId);
  restyle = "skipped";
}
if (input.mode === "i2v" && !referenceBytes) throw new Error("video_reference_unresolvable");
```
  Add `sceneMode: input.sceneMode` and `restyle` to the returned `meta`.
  In `providers.ts` `generateWithComfyWan`, compute
  `const interpolate = WAN_STEPS[preset].interpolate && videoInterpolationEnabled();`
  and pass `interpolate` into `buildWanWorkflow({...})`. Import `WAN_STEPS`, `videoInterpolationEnabled`.
- [ ] **Step 4: Run tests + backend typecheck. Run the full media suite** (`npx vitest run backend/src/media`) to confirm no regressions.

---

### Task 6: Frontend — 8s duration + Transform/Keep toggle

**Files:**
- Modify: `frontend/components/create-video/CreateVideoForm.tsx`

**Interfaces:**
- Consumes: `sceneMode` field name from Task 1.

- [ ] **Step 1: Add duration + scene-mode options.**
  - `type Seconds = 3 | 5 | 8;` and add `{ value: 8, label: "8s" }` to `DURATIONS`.
  - Add `type SceneMode = "transform" | "keep";` and a constant:

```ts
const SCENE_MODES: { value: SceneMode; label: string; hint: string }[] = [
  { value: "transform", label: "Transform scene", hint: "New outfit/scene from your prompt" },
  { value: "keep", label: "Keep my photo", hint: "Animate your exact photo" },
];
```
  - Add state: `const [sceneMode, setSceneMode] = React.useState<SceneMode>("transform");`
- [ ] **Step 2: Render the toggle** as a new `<Panel>` (before or after Quality) using two `OptionCard`s (align="row") mirroring the Quality block, driven by `SCENE_MODES`, wired to `sceneMode`/`setSceneMode`. Add a one-line helper under the label: "Transform changes the outfit/scene from your prompt; Keep animates your photo as-is."
- [ ] **Step 3: Send `sceneMode` in the POST body** inside `handleGenerate` (`payload: { userRequest, mode:"i2v", seconds, aspectRatio, quality, sceneMode }`). Update the backend-contract comment at the top to include `sceneMode`.
- [ ] **Step 4: Verify** `npm run typecheck` (frontend) and `npm run build` (or `next lint`) pass. No new test framework wiring required; this is a client component.

---

### Task 7: Provision the RIFE custom node on the video box

**Files:**
- Modify: `Plans/inference-video-aws/user-data.sh`
- Create: `Plans/inference-video-aws/install-rife.sh` (one-off installer for the already-running box)

**Interfaces:** none (infra/shell). No app code depends on this at build time; Stage C stays gated off (`WAN_INTERPOLATION` unset) until the node is present.

- [ ] **Step 1:** In `user-data.sh`, after ComfyUI is cloned/updated, add (idempotent) install of the interpolation node into `ComfyUI/custom_nodes`:
  - `git clone https://github.com/Fannovel16/ComfyUI-Frame-Interpolation` (skip if the dir exists),
  - `pip install -r` its requirements (into the same venv/python ComfyUI uses),
  - ensure the `rife49.pth` checkpoint is present (the node auto-downloads on first use; document that first render warms it).
  - Follow the file's existing quoting/style conventions (single-line where the file does).
- [ ] **Step 2:** Create `install-rife.sh` that SSHes/execs the same three steps against the running box for a live install without a full re-provision. Mirror the connection pattern used by the sibling scripts (`wan-start.sh`/`status.sh`); read host from the same config source. Do NOT run it (human runs it when ready).
- [ ] **Step 3:** Add a short comment/README note: after install, set `WAN_INTERPOLATION=1` in the backend env to enable Stage C. No em dashes; no auto-run.

---

### Task 8: Box smoke script for scene-change + smoothness

**Files:**
- Create: `backend/scripts/wan-scene-e2e.ts` (mirrors `wan-i2v-e2e.ts`)

**Interfaces:** Consumes `restyleFirstFrame`, `generateVideo`.

- [ ] **Step 1:** Script: given `[characterId] [preset]`, run `restyleFirstFrame` with a scene-changing prompt (e.g. "wearing a blue dress, standing on a sunny beach"), write the restyled frame to the scratchpad as a PNG for eyeballing identity, then `generateVideo({ mode:"i2v", referenceBytes: <restyled>, preset, aspect:"portrait", seconds:5 })`, write the webm, and print provider/bytes/latency + whether the output fps is 32 (log meta). Load `backend/.env` like the sibling scripts.
- [ ] **Step 2:** Do NOT run against the box automatically (the box may be scaled to zero; running incurs cost). Leave it as a manual tool and note the invocation in a top comment.

---

## Self-Review

- Spec coverage: Stage A (Task 4+5), Stage B motion (Task 2 presets + Task 3 hq), Stage C interpolation (Task 2 config + Task 3 node + Task 7 infra), duration (Task 1 + Task 6), toggle (Task 1 + Task 6), testing (each task + Task 8). Covered.
- Type consistency: `sceneMode` values `transform|keep` identical across Tasks 1/5/6. `interpolate` arg added in Task 3, supplied in Task 5. `WAN_STEPS[preset].interpolate|hq` added in Task 2, read in Tasks 3/5.
- No placeholders: all steps carry concrete code or exact commands.
