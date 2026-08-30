# Character LoRA Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-character SDXL LoRA training + a LoRA-aware generation path (RealVisXL base, detailer/upscale tail, expression/pose control) so flagship characters reach exact face consistency and correct hands.

**Architecture:** Two subsystems over the existing flag-gated ComfyUI workflow builder. (A) A training pipeline that curates a dataset, trains a kohya SDXL LoRA on an ephemeral box, validates it against the existing ArcFace gate, and promotes it into a new `CharacterLora` row. (B) Generation reads a `ready` LoRA and inserts a `LoraLoader` block, lowers InstantID weight, selects RealVisXL, and runs the FaceDetailer + hand + upscale tail. Everything is flag-gated and byte-identical when off.

**Tech Stack:** TypeScript (strict, CJS backend), Prisma 6 + Postgres, BullMQ + Redis, ComfyUI (SDXL), kohya_ss, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-character-lora-consistency-design.md`

## Global Constraints

- Prisma singleton only: `import { prisma } from "@buttercupp/database"`. Never `new PrismaClient()`.
- Strict TypeScript. No `any` without an explaining comment. `zod` at every trust boundary.
- No em dash (U+2014) anywhere. Enforced by `npm run check:no-em-dash` + eslint `buttercupp/no-em-dash`.
- Byte-identical invariant: with all new flags OFF, the assembled ComfyUI graph JSON is unchanged from today. There is an existing test (`workflow/assemble.test.ts`) that must keep passing.
- Migrations run against a LOCAL database only. Never against prod. Never commit/push/deploy without a fresh per-action human approval.
- New workflow blocks are pure functions returning `Record<string, unknown>` node dicts, following `workflow/base.ts`, `workflow/instantid.ts`, etc.
- Node-number convention (already in use): base 4-7, InstantID 10/20-23/3/8, faceswap 50, pulid 60-63, facedetailer 70-71, hand 80-82, pose 90-94, video refine 100-102. New: LoRA 30, upscale tail 110-113.

---

## Phase 0: Foundation (DB + shared schema)

### Task 1: CharacterLora model + local migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (add model after `AppearanceSheet`, ends line 310)
- Migration: `packages/database/prisma/migrations/<generated>/migration.sql` (via `prisma migrate dev`, LOCAL db)

**Interfaces:**
- Produces: Prisma model `CharacterLora` with fields listed below, exported through the generated client re-exported by `@buttercupp/database`.

- [ ] **Step 1: Add the model to `schema.prisma`**

```prisma
model CharacterLora {
  id                 String   @id @default(uuid())
  characterId        String
  characterVersionId String
  status             String   @default("pending") // pending|building|training|validating|ready|rejected|failed
  s3Key              String?
  triggerToken       String?
  baseModel          String   @default("realvisxl_v5") // realvisxl_v5 | juggernaut_xl_v9
  rank               Int      @default(32)
  checkpointStep     Int?
  arcfaceScore       Float?
  datasetKey         String?
  error              String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([characterId])
  @@index([status])
}
```

- [ ] **Step 2: Generate the migration against the LOCAL db**

Run: `cd packages/database && npx prisma migrate dev --name add_character_lora`
Expected: a new migration dir + `CharacterLora` table created locally, client regenerated.
NOTE: this touches the LOCAL db only. Do not run `migrate deploy` anywhere.

- [ ] **Step 3: Typecheck the workspace**

Run: `npm run typecheck`
Expected: PASS. Confirms the generated client exposes `prisma.characterLora`.

- [ ] **Step 4: Commit** (ask first per guardrails)

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add CharacterLora model for per-character LoRA tracking"
```

### Task 2: Shared enums + train-lora payload schema

**Files:**
- Create: `packages/shared/src/lora.ts`
- Modify: `packages/shared/src/index.ts` (export the new module; verify it re-exports siblings)
- Test: `packages/shared/src/lora.test.ts`

**Interfaces:**
- Produces:
  - `expressionSchema: z.ZodEnum` with values `neutral, smiling, happy, sad, seductive, laughing, surprised`; type `Expression`.
  - `poseSchema: z.ZodEnum` with values `front, three_quarter_left, three_quarter_right, profile, over_shoulder, sitting, lying, arms_up`; type `Pose`.
  - `trainLoraJobPayloadSchema` (zod) + type `TrainLoraJobPayload`.
  - `LoraStatus` union type mirrored from the DB status strings.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { expressionSchema, poseSchema, trainLoraJobPayloadSchema } from "./lora";

describe("lora shared schemas", () => {
  it("accepts a valid expression and rejects an unknown one", () => {
    expect(expressionSchema.parse("seductive")).toBe("seductive");
    expect(expressionSchema.safeParse("angry").success).toBe(false);
  });
  it("defaults targetImageCount and validates ids", () => {
    const p = trainLoraJobPayloadSchema.parse({
      source: "train-lora",
      characterId: "c1",
      characterVersionId: "v1",
      requestedBy: "admin",
    });
    expect(p.targetImageCount).toBe(30);
  });
  it("rejects a missing characterId", () => {
    expect(
      trainLoraJobPayloadSchema.safeParse({ source: "train-lora", characterVersionId: "v1", requestedBy: "a" }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm --workspace @buttercupp/shared test -- lora`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/shared/src/lora.ts`**

```typescript
import { z } from "zod";

export const expressionSchema = z.enum([
  "neutral", "smiling", "happy", "sad", "seductive", "laughing", "surprised",
]);
export type Expression = z.infer<typeof expressionSchema>;

export const poseSchema = z.enum([
  "front", "three_quarter_left", "three_quarter_right", "profile",
  "over_shoulder", "sitting", "lying", "arms_up",
]);
export type Pose = z.infer<typeof poseSchema>;

export const LORA_STATUSES = [
  "pending", "building", "training", "validating", "ready", "rejected", "failed",
] as const;
export type LoraStatus = (typeof LORA_STATUSES)[number];

// Enqueued by the admin train action; validated by the train-lora worker handler.
export const trainLoraJobPayloadSchema = z.object({
  source: z.literal("train-lora"),
  characterId: z.string().min(1).max(64),
  characterVersionId: z.string().min(1).max(64),
  requestedBy: z.string().min(1).max(128),
  targetImageCount: z.number().int().min(15).max(80).default(30),
  baseModel: z.enum(["realvisxl_v5", "juggernaut_xl_v9"]).default("realvisxl_v5"),
});
export type TrainLoraJobPayload = z.infer<typeof trainLoraJobPayloadSchema>;
```

- [ ] **Step 4: Export from `index.ts`**

Add `export * from "./lora";` alongside the existing exports.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm --workspace @buttercupp/shared test -- lora && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit** (ask first)

```bash
git add packages/shared/src/lora.ts packages/shared/src/lora.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): expression/pose enums + train-lora job payload"
```

---

## Phase B: Generation-side (parallel with Phase A after Phase 0)

### Task 3: LoRA loader workflow block

**Files:**
- Create: `backend/src/media/image/workflow/lora.ts`
- Test: `backend/src/media/image/workflow/lora.test.ts`

**Interfaces:**
- Produces: `loraNode(a: { loraName: string; strength?: number }): { nodes: Record<string, unknown>; modelRef: [string, number]; clipRef: [string, number] }`. Node id `30` = `LoraLoader` consuming `["4",0]`/`["4",1]` (checkpoint model/clip) and producing model at `["30",0]`, clip at `["30",1]`.
- Const `LORA_DEFAULTS = { strength: 0.85 }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { loraNode, LORA_DEFAULTS } from "./lora";

describe("loraNode", () => {
  it("wires LoraLoader off the checkpoint and exposes model+clip refs", () => {
    const r = loraNode({ loraName: "ch_abc.safetensors" });
    const n = r.nodes["30"] as { class_type: string; inputs: Record<string, unknown> };
    expect(n.class_type).toBe("LoraLoader");
    expect(n.inputs.model).toEqual(["4", 0]);
    expect(n.inputs.clip).toEqual(["4", 1]);
    expect(n.inputs.lora_name).toBe("ch_abc.safetensors");
    expect(n.inputs.strength_model).toBe(LORA_DEFAULTS.strength);
    expect(r.modelRef).toEqual(["30", 0]);
    expect(r.clipRef).toEqual(["30", 1]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npm --workspace backend test -- workflow/lora`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lora.ts`**

```typescript
// LoRA loader (node 30). Sits between the checkpoint (node 4) and everything
// that consumes model/clip, so a per-character trained LoRA conditions the whole
// graph. modelRef feeds InstantID's model input; clipRef re-encodes the prompt
// (with the trigger token) so the LoRA's identity token is active.
export const LORA_DEFAULTS = { strength: 0.85 } as const;

export function loraNode(a: { loraName: string; strength?: number }): {
  nodes: Record<string, unknown>;
  modelRef: [string, number];
  clipRef: [string, number];
} {
  const strength = a.strength ?? LORA_DEFAULTS.strength;
  return {
    nodes: {
      "30": {
        class_type: "LoraLoader",
        inputs: {
          model: ["4", 0],
          clip: ["4", 1],
          lora_name: a.loraName,
          strength_model: strength,
          strength_clip: strength,
        },
      },
    },
    modelRef: ["30", 0],
    clipRef: ["30", 1],
  };
}
```

- [ ] **Step 4: Run test, verify PASS.** Run: `npm --workspace backend test -- workflow/lora`.

- [ ] **Step 5: Commit** (ask first). `feat(image): LoRA loader workflow block`

### Task 4: Wire LoRA into assemble + lower InstantID weight + trigger injection

**Files:**
- Modify: `backend/src/media/image/workflow/base.ts` (accept optional `clipRef` so CLIP encodes read the LoRA clip)
- Modify: `backend/src/media/image/workflow/assemble.ts` (insert LoRA block; thread model/clip refs; lower ipWeight)
- Modify: `backend/src/media/image/workflow/assemble.test.ts` (byte-identical-when-off + LoRA-on cases)

**Interfaces:**
- Consumes: `loraNode` (Task 3), `ImageWorkflowFlags` (extended in Task 7 with `lora`).
- `AssembleArgs` gains: `loraName?: string; loraStrength?: number; loraIpWeight?: number` (default lowered weight `0.6`).
- Produces: when `flags.lora && loraName && has("LoraLoader")`, node 30 is added, base CLIP encodes (6,7) read `clip` from `["30",1]` instead of `["4",1]`, InstantID model source becomes `["30",0]` (unless pose/pulid already set `modelRef`), and InstantID `ipWeight` defaults to `loraIpWeight` (0.6).

- [ ] **Step 1: Update `base.ts` to accept an optional clip ref**

```typescript
export function baseNodes(a: {
  ckpt: string;
  positive: string;
  negative: string;
  clipRef?: [string, number];
}): Record<string, unknown> {
  const clip = a.clipRef ?? (["4", 1] as [string, number]);
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: CANVAS.width, height: CANVAS.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip } },
  };
}
```

- [ ] **Step 2: Write the failing assemble tests**

Add to `assemble.test.ts`:

```typescript
it("is byte-identical when the lora flag is off (regression guard)", () => {
  const off = assembleConsistentWorkflow({
    ckpt: "juggernautXL_v9.safetensors", positive: "p", negative: "n",
    refName: "r.png", seed: 1, flags: resolveImageFlags(),
  });
  expect(off["30"]).toBeUndefined();
  expect((off["6"] as any).inputs.clip).toEqual(["4", 1]);
});

it("inserts LoRA node 30, reroutes clip, lowers ipWeight when lora on", () => {
  const on = assembleConsistentWorkflow({
    ckpt: "realvisxlV50.safetensors", positive: "ch_abc woman", negative: "n",
    refName: "r.png", seed: 1, flags: resolveImageFlags({ lora: true }),
    loraName: "ch_abc.safetensors",
    availableNodes: new Set(["LoraLoader", "ApplyInstantIDAdvanced"]),
  });
  expect((on["30"] as any).class_type).toBe("LoraLoader");
  expect((on["6"] as any).inputs.clip).toEqual(["30", 1]);
  expect((on["23"] as any).inputs.model).toEqual(["30", 0]);
  expect((on["23"] as any).inputs.ip_weight).toBe(0.6);
});
```

- [ ] **Step 3: Run tests, verify the new ones fail.** Run: `npm --workspace backend test -- workflow/assemble`. Expected: 2 new FAIL, old ones PASS.

- [ ] **Step 4: Implement the wiring in `assemble.ts`**

At the top of `assembleConsistentWorkflow`, before `baseNodes`, resolve the LoRA:

```typescript
const useLora = a.flags.lora && Boolean(a.loraName) && has("LoraLoader");
let clipRef: [string, number] | undefined;
let loraModelRef: [string, number] | undefined;
if (useLora) {
  const lora = loraNode({ loraName: a.loraName as string, strength: a.loraStrength });
  Object.assign(g, lora.nodes);
  clipRef = lora.clipRef;
  loraModelRef = lora.modelRef;
}
```

Change the `baseNodes` call to pass `clipRef`. After the pose/pulid `modelRef` logic, make the LoRA model the InstantID source when nothing else set it, and lower ipWeight:

```typescript
if (!modelRef && loraModelRef) modelRef = loraModelRef;
const ipWeight = usePose
  ? a.ipWeight ?? POSE.ipWeight
  : useLora
    ? a.loraIpWeight ?? 0.6
    : a.ipWeight;
```

(The existing `Object.assign(g, baseNodes(...))` at the top must move to AFTER the LoRA block so node 30 exists; keep node ids stable. Since `baseNodes` only creates 4-7 and LoRA only 30, order of `Object.assign` does not matter for correctness, but compute `clipRef` before calling `baseNodes`.)

- [ ] **Step 5: Run all image workflow tests.** Run: `npm --workspace backend test -- workflow`. Expected: PASS (byte-identical guard + LoRA cases).

- [ ] **Step 6: Commit** (ask first). `feat(image): wire per-character LoRA into the consistent workflow`

### Task 5: Upscale tail block + IMG_UPSCALE_TAIL flag

**Files:**
- Create: `backend/src/media/image/workflow/upscale.ts`
- Test: `backend/src/media/image/workflow/upscale.test.ts`
- Modify: `backend/src/media/image/workflow/assemble.ts` (append tail after hand detailer)

**Interfaces:**
- Produces: `upscaleNodes(a: { inputImage: [string, number]; model?: [string,number]; positive: [string,number]; negative: [string,number]; vae: [string,number]; seed: number }): { nodes: Record<string, unknown>; outId: string }`. Uses a 2x latent upscale + low-denoise KSampler skin pass. Node ids 110 (UpscaleModelLoader or LatentUpscale), 111 (KSampler), 112 (VAEDecode); `outId = "112"`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { upscaleNodes } from "./upscale";

describe("upscaleNodes", () => {
  it("adds a 2x latent upscale + low-denoise refine and returns the decode id", () => {
    const r = upscaleNodes({
      inputImage: ["50", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 7,
    });
    expect(r.outId).toBe("112");
    const k = r.nodes["111"] as any;
    expect(k.class_type).toBe("KSampler");
    expect(k.inputs.denoise).toBeLessThanOrEqual(0.35);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL.** Run: `npm --workspace backend test -- workflow/upscale`.

- [ ] **Step 3: Implement `upscale.ts`**

```typescript
// Skin/texture upscale tail. Encodes the finished image to latent, upscales 2x,
// and runs a LOW-denoise KSampler so pores/texture appear without changing
// identity or composition. Runs last (after face + hand detailers).
export const UPSCALE_DEFAULTS = { factor: 2, denoise: 0.3, steps: 18, cfg: 5 } as const;

export function upscaleNodes(a: {
  inputImage: [string, number];
  positive: [string, number];
  negative: [string, number];
  vae: [string, number];
  model?: [string, number];
  seed: number;
}): { nodes: Record<string, unknown>; outId: string } {
  const model = a.model ?? (["4", 0] as [string, number]);
  return {
    nodes: {
      "110": { class_type: "VAEEncode", inputs: { pixels: a.inputImage, vae: a.vae } },
      "113": {
        class_type: "LatentUpscaleBy",
        inputs: { samples: ["110", 0], upscale_method: "nearest-exact", scale_by: UPSCALE_DEFAULTS.factor },
      },
      "111": {
        class_type: "KSampler",
        inputs: {
          model, positive: a.positive, negative: a.negative, latent_image: ["113", 0],
          seed: a.seed, steps: UPSCALE_DEFAULTS.steps, cfg: UPSCALE_DEFAULTS.cfg,
          sampler_name: "dpmpp_2m", scheduler: "karras", denoise: UPSCALE_DEFAULTS.denoise,
        },
      },
      "112": { class_type: "VAEDecode", inputs: { samples: ["111", 0], vae: a.vae } },
    },
    outId: "112",
  };
}
```

- [ ] **Step 4: Wire into `assemble.ts`** after the hand-detailer block, before the video-refine block:

```typescript
if (a.flags.upscaleTail && has("LatentUpscaleBy")) {
  const up = upscaleNodes({
    inputImage: lastImage, positive: ["6", 0], negative: ["7", 0],
    vae: ["4", 2], model: modelRef, seed: a.seed,
  });
  Object.assign(g, up.nodes);
  lastImage = [up.outId, 0];
}
```

- [ ] **Step 5: Run tests + the byte-identical guard.** Run: `npm --workspace backend test -- workflow`. Expected: PASS (guard asserts node 110 absent when off).

- [ ] **Step 6: Commit** (ask first). `feat(image): 2x upscale + skin-texture tail block`

### Task 6: Flags additions (lora, upscaleTail)

**Files:**
- Modify: `backend/src/media/image/flags.ts`
- Modify: `backend/src/media/image/flags.test.ts`

**Interfaces:**
- Produces: `ImageWorkflowFlags` gains `lora: boolean; upscaleTail: boolean`; env `IMG_LORA`, `IMG_UPSCALE_TAIL`.

- [ ] **Step 1: Add failing test** asserting both default false and flip via env/override.

```typescript
it("defaults lora and upscaleTail off, honors overrides", () => {
  const f = resolveImageFlags();
  expect(f.lora).toBe(false);
  expect(f.upscaleTail).toBe(false);
  expect(resolveImageFlags({ lora: true }).lora).toBe(true);
});
```

- [ ] **Step 2: Run, verify FAIL.** `npm --workspace backend test -- image/flags`.

- [ ] **Step 3: Extend `flags.ts`** interface + `fromEnv` with `lora: envOn("IMG_LORA")`, `upscaleTail: envOn("IMG_UPSCALE_TAIL")`.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** (ask first). `feat(image): IMG_LORA + IMG_UPSCALE_TAIL flags`

### Task 7: Expression + pose plumbing into prompt build and generation entry

**Files:**
- Modify: `backend/src/media/image/prompt.ts` (accept `expression?: Expression`, `pose?: Pose`; append expression tokens + map pose to skeleton name)
- Modify: `backend/src/media/image/prompt.test.ts`
- Modify: `backend/src/media/image/pose-library.ts` (ensure `poseSchema` values map to skeleton names; add any missing)
- Modify: `backend/src/media/image/providers.ts` (`generateWithComfyUIConsistent` threads expression/pose into prompt + `poseSkeletonName`, resolves LoRA name from the character's `CharacterLora`)
- Modify: `backend/src/media/handlers/image.ts` (load `CharacterLora` for the character; pass `loraName`/`baseModel` and expression/pose)

**Interfaces:**
- Consumes: `expressionSchema`, `poseSchema` (Task 2); `loraNode` wiring (Task 4); `CharacterLora` (Task 1).
- Produces: `buildImagePrompt` accepts `{ expression?: Expression; pose?: Pose }` and injects an expression fragment (e.g. `seductive` -> `seductive expression, bedroom eyes`); the handler resolves `const lora = await prisma.characterLora.findFirst({ where: { characterId, status: "ready" }, orderBy: { createdAt: "desc" } })` and passes `loraName = basename(lora.s3Key)`, `baseModel`, and sets `flags.lora` when a ready LoRA exists.

- [ ] **Step 1: Write failing prompt test**

```typescript
it("appends an expression fragment and keeps trigger ordering", () => {
  const { positive } = buildImagePrompt({ sheet, scene: "on a beach", expression: "seductive" });
  expect(positive).toMatch(/seductive/);
});
```

- [ ] **Step 2: Run, verify FAIL.** `npm --workspace backend test -- image/prompt`.

- [ ] **Step 3: Implement expression map** in `prompt.ts`:

```typescript
const EXPRESSION_FRAGMENTS: Record<Expression, string> = {
  neutral: "neutral expression",
  smiling: "warm smile",
  happy: "happy, bright smile",
  sad: "sad, wistful expression",
  seductive: "seductive expression, bedroom eyes, parted lips",
  laughing: "laughing, joyful",
  surprised: "surprised expression, wide eyes",
};
```

Append the fragment to the positive prompt when `expression` is provided.

- [ ] **Step 4: Thread pose -> skeleton** in `providers.ts`: map `poseSchema` value to a `pose-library` skeleton name; pass as `poseSkeletonName` to `assembleConsistentWorkflow`.

- [ ] **Step 5: Resolve LoRA in `handlers/image.ts`**: query the newest `ready` `CharacterLora`; when found set `flags.lora = true`, `loraName`, `baseModel` -> checkpoint filename; otherwise unchanged (adapter path).

- [ ] **Step 6: Run image + prompt + workflow tests.** Run: `npm --workspace backend test -- image`. Expected: PASS.

- [ ] **Step 7: Commit** (ask first). `feat(image): expression/pose control + LoRA resolution in the image handler`

---

## Phase A: Training pipeline (parallel with Phase B after Phase 0)

Directory for new training code: `backend/src/media/lora/`.

### Task 8: Dataset builder

**Files:**
- Create: `backend/src/media/lora/dataset.ts`
- Test: `backend/src/media/lora/dataset.test.ts`

**Interfaces:**
- Produces: `buildDataset(a: { characterId: string; characterVersionId: string; targetCount: number }): Promise<{ images: DatasetImage[]; manifestKey: string }>` where `DatasetImage = { key: string; kind: "gallery" | "turntable"; caption?: string; arcfaceScore: number }`.
- Depends on: existing reference resolution (`backend/src/media/reference.ts`), the live image box turntable generation (reuse `generateWithComfyUIConsistent`), and an ArcFace scorer (`scoreArcface(refKey, candidateKey): Promise<number>` - a thin client to the box's InsightFace, or a local onnxruntime helper; define in `backend/src/media/lora/arcface.ts` with a stub-friendly interface so tests inject a fake).

- [ ] **Step 1: Write the failing test** with an injected fake image source + fake scorer:

```typescript
it("curates: drops candidates below the arcface threshold and caps at targetCount", async () => {
  const fakeGallery = ["g1", "g2", "g3"];
  const scores: Record<string, number> = { g1: 0.9, g2: 0.4, g3: 0.85 };
  const out = await buildDataset({
    characterId: "c1", characterVersionId: "v1", targetCount: 2,
  }, { listGallery: async () => fakeGallery, score: async (_r, k) => scores[k], genTurntable: async () => [], uploadManifest: async () => "m.json" });
  expect(out.images.map((i) => i.key)).not.toContain("g2");
  expect(out.images.length).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run, verify FAIL.** `npm --workspace backend test -- lora/dataset`.

- [ ] **Step 3: Implement `dataset.ts`** with a `Deps` param (dependency injection) so the test passes fakes; production wiring passes real S3/box clients. Threshold constant `ARCFACE_MIN = 0.6`. Curate = filter by score, sort desc, take `targetCount`, write manifest.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** (ask first). `feat(lora): dataset builder with arcface curation`

### Task 9: Captioner

**Files:**
- Create: `backend/src/media/lora/caption.ts`
- Test: `backend/src/media/lora/caption.test.ts`

**Interfaces:**
- Produces: `captionImage(a: { imageKey: string; triggerToken: string }, deps: CaptionDeps): Promise<string>` and `makeTriggerToken(characterId: string): string` (returns `ch_<8-hex>`). Captions must START with the trigger token and describe pose/framing/background, per kohya SDXL convention.

- [ ] **Step 1: Failing test** asserting caption starts with the trigger and `makeTriggerToken` shape:

```typescript
it("prefixes the trigger token", async () => {
  const c = await captionImage({ imageKey: "k", triggerToken: "ch_abc12345" }, { vlmCaption: async () => "a woman sitting on a couch" });
  expect(c.startsWith("ch_abc12345")).toBe(true);
});
it("trigger token matches ch_<8hex>", () => {
  expect(makeTriggerToken("c1")).toMatch(/^ch_[0-9a-f]{8}$/);
});
```

- [ ] **Step 2: Run, FAIL.** **Step 3: Implement** (call a VLM via injected `vlmCaption` dep; prepend trigger; strip any accidental face descriptors). **Step 4: PASS.** **Step 5: Commit** (ask first). `feat(lora): captioner`

### Task 10: kohya trainer launch + config

**Files:**
- Create: `backend/src/media/lora/train.ts` (spawns the trainer on the ephemeral box via SSH/HTTP; builds the kohya config)
- Create: `Plans/inference-training-aws/kohya-sdxl-lora.toml` (config template)
- Test: `backend/src/media/lora/train.test.ts`

**Interfaces:**
- Produces: `buildKohyaConfig(a: { datasetDir: string; outputName: string; rank: number }): string` (returns TOML) and `runTraining(a, deps): Promise<{ checkpoints: { step: number; key: string }[] }>` where the box interaction is an injected dep.

- [ ] **Step 1: Failing test** on `buildKohyaConfig` asserting rank/alpha/steps/resolution appear and no em dash.

```typescript
it("emits rank 32 alpha 16 at 1024 res", () => {
  const toml = buildKohyaConfig({ datasetDir: "/d", outputName: "ch_abc", rank: 32 });
  expect(toml).toMatch(/network_dim\s*=\s*32/);
  expect(toml).toMatch(/network_alpha\s*=\s*16/);
  expect(toml).not.toContain("\u2014");
});
```

- [ ] **Step 2-4:** implement + pass. `runTraining` posts the job to the box and collects checkpoint keys via the injected dep.
- [ ] **Step 5: Commit** (ask first). `feat(lora): kohya SDXL trainer launch + config`

### Task 11: ArcFace validator harness

**Files:**
- Create: `backend/src/media/lora/validate.ts`
- Test: `backend/src/media/lora/validate.test.ts`

**Interfaces:**
- Produces: `validateLora(a: { referenceKey: string; checkpoints: {step:number;key:string}[]; promptSet: string[] }, deps): Promise<{ bestStep: number; bestKey: string; meanScore: number; baselineScore: number; pass: boolean }>`. `pass = meanScore >= baselineScore` (the do-not-disturb gate). Generation + scoring are injected deps so the test runs GPU-free.

- [ ] **Step 1: Failing test**: given fake per-checkpoint scores and a baseline, picks the highest-mean checkpoint and sets `pass` correctly.

```typescript
it("selects the best checkpoint and passes only when it beats baseline", async () => {
  const r = await validateLora(
    { referenceKey: "r", checkpoints: [{ step: 500, key: "a" }, { step: 750, key: "b" }], promptSet: ["p1", "p2"] },
    { baseline: async () => 0.70, scoreChain: async (_ref, ck) => (ck === "b" ? 0.82 : 0.66) },
  );
  expect(r.bestKey).toBe("b");
  expect(r.pass).toBe(true);
});
```

- [ ] **Step 2-4:** implement + pass. **Step 5: Commit** (ask first). `feat(lora): validator harness with arcface gate + checkpoint selection`

### Task 12: Promoter

**Files:**
- Create: `backend/src/media/lora/promote.ts`
- Test: `backend/src/media/lora/promote.test.ts`

**Interfaces:**
- Produces: `promoteLora(a: { loraId: string; result: ValidateResult; s3Key: string; triggerToken: string }): Promise<void>`. On `pass`: update the `CharacterLora` row to `status: "ready"`, set `s3Key`, `triggerToken`, `checkpointStep`, `arcfaceScore`; mirror `s3Key` into the version's `AppearanceSheet.loraRef`. On fail: `status: "rejected"`, set `error`. Uses the Prisma singleton.

- [ ] **Step 1: Failing test** with a test/local db (or a mocked `prisma` via the existing test setup) asserting a passing result flips status to `ready` and sets `loraRef`.
- [ ] **Step 2-4:** implement + pass. **Step 5: Commit** (ask first). `feat(lora): promoter writes CharacterLora + AppearanceSheet.loraRef`

### Task 13: train-lora BullMQ job + worker handler

**Files:**
- Create: `backend/src/media/lora/handler.ts` (orchestrates build -> caption -> train -> validate -> promote, updating `CharacterLora.status` at each stage)
- Modify: `backend/src/queue/media-queue.ts` (add `enqueueTrainLoraJob(payload)`; or a dedicated `lora-queue.ts` if isolation is cleaner - prefer a dedicated queue `buttercupp-lora` so training never blocks media)
- Create: `backend/src/queue/lora-worker.ts` (single-worker, low concurrency; validates payload with `trainLoraJobPayloadSchema`)
- Test: `backend/src/media/lora/handler.test.ts`

**Interfaces:**
- Consumes: Tasks 8-12 + `trainLoraJobPayloadSchema` (Task 2).
- Produces: `runTrainLoraJob(payload: TrainLoraJobPayload): Promise<void>` that advances a `CharacterLora` row through statuses and calls the five stages, catching errors into `status: "failed"` + `error`.

- [ ] **Step 1: Failing test** injecting fake stage deps, asserting status transitions `building -> training -> validating -> ready` on success and `failed` on a thrown stage.
- [ ] **Step 2-4:** implement + pass. **Step 5: Commit** (ask first). `feat(lora): train-lora orchestration + dedicated worker`

### Task 14: Admin on-demand trigger

**Files:**
- Create: `backend/src/http/lora.ts` (admin-only `POST /admin/lora/train` -> creates a `CharacterLora` row `pending` + enqueues; `GET /admin/lora/:characterId` -> status). Guard with the existing admin auth used elsewhere in `backend/src/http/`.
- Create: `scripts/train-lora.ts` (CLI: `npm run lora:train -- <characterId>` for local/manual triggering)
- Modify: route registration index in `backend/src/http/`
- Test: `backend/src/http/lora.test.ts`

**Interfaces:**
- Consumes: `enqueueTrainLoraJob` (Task 13). Zod-validate the request body.

- [ ] **Step 1: Failing test** asserting a non-admin is 403 and an admin enqueues + returns the new `loraId`.
- [ ] **Step 2-4:** implement + pass. **Step 5: Commit** (ask first). `feat(lora): admin train endpoint + CLI trigger`

### Task 15: Ephemeral training-box scripts (author only, do NOT run)

**Files:**
- Create: `Plans/inference-training-aws/README.md` (instance type g5/g6 24GB, scale-to-zero, capacity-error fallback AZ, IAM, SG, budget alarm)
- Create: `Plans/inference-training-aws/user-data.sh` (install kohya_ss + ComfyUI + download RealVisXL, upscaler, InsightFace; bake into AMI)
- Create: `Plans/inference-training-aws/train-box-router.md` (start-on-enqueue / stop-on-idle, mirrors the Wan video box pattern)

**Interfaces:** none (infra docs/scripts). These are authored for review; running them provisions AWS and is approval-gated per the guardrails.

- [ ] **Step 1:** Write the three files, mirroring `Plans/inference-video-aws/` conventions and the model list from the spec.
- [ ] **Step 2:** `npm run check:no-em-dash` over the new files. Expected: clean.
- [ ] **Step 3: Commit** (ask first). `docs(infra): ephemeral LoRA training box scripts (not yet provisioned)`

---

## Self-Review notes

- Spec coverage: Subsystem A -> Tasks 8-15; Subsystem B -> Tasks 3-7; data model -> Task 1; shared schema -> Task 2. Base-model selection is inside Task 7 (handler resolves `baseModel` -> checkpoint filename). RealVisXL evaluation (spec build-order step 2) is an operational validation done via Task 11's harness once a box exists, not a code task.
- Byte-identical invariant guarded in Tasks 4 and 5 tests.
- Prod boundary: every `migrate`, real training run, box provisioning, and all commits are explicitly approval-gated (Global Constraints + Task 15).
- Types consistent: `loraNode` (Task 3) refs consumed verbatim in Task 4; `trainLoraJobPayloadSchema` (Task 2) consumed in Tasks 13-14; `CharacterLora` fields (Task 1) consumed in Tasks 7, 12, 13.

## Execution order

Phase 0 (Tasks 1-2) first, sequential. Then Phase B (3-7) and Phase A (8-15) in parallel. Within each phase, tasks are mostly sequential by file dependency; Tasks 8/9/10/11/12 are independently testable via injected deps and can be split across agents, converging at Task 13.
