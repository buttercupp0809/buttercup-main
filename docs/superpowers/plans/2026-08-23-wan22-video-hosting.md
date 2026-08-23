# Wan 2.2 A14B Video Generation Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-hosted Wan 2.2 A14B video generation (I2V + T2V) on a dedicated scale-to-zero GPU box, delivered async through the existing BullMQ media queue.

**Architecture:** A new `Plans/inference-video-aws/` shell stack provisions a dedicated g6e.xlarge (L40S 45GB) box running ComfyUI + Wan 2.2 A14B fp8, isolated from the known-good A10G Stheno/Juggernaut box. The backend gains a `videoEndpoint` resolver, a self-hosted Wan provider inserted ahead of the existing Fal/Replicate fallback, a two-expert ComfyUI workflow builder, and a `video` queue handler mirroring the image handler. The box is scale-to-zero (start-on-enqueue, stop-on-idle).

**Tech Stack:** Node + TypeScript (CommonJS build), vitest, BullMQ, ComfyUI, Wan 2.2 A14B fp8 + LightX2V Lightning LoRAs, AWS CLI (EC2, Lambda router), S3/CloudFront.

**Spec:** `docs/superpowers/specs/2026-08-23-wan22-video-hosting-design.md`

## Global Constraints

Copied verbatim from repo rules (`CLAUDE.md`) and the spec. Every task's requirements implicitly include this section.

- There is exactly one `PrismaClient` per process. Never write `new PrismaClient()` outside `packages/database/src/client.ts`. Import `{ prisma } from "@buttercupp/database"`.
- Do not use the em dash character (U+2014) anywhere: code, comments, docs, commit messages. Use commas, periods, or parentheses.
- Strict TypeScript everywhere. No `any` unless annotated with a comment explaining why the type cannot be modeled.
- `zod` validates every mutation at the trust boundary (route handlers, WS messages, worker payloads, webhook bodies). Never trust shape from types alone.
- Backend TS compiles to CommonJS in `dist/`.
- Tests use vitest. Run a single file with `npx vitest run <path>` from the repo root; run all with `npm test`. Tests are colocated as `*.test.ts` or under a sibling `__tests__/` directory.
- APPROVAL-GATED (never auto-run, ask the human per-action): any `git commit` / `git push`; provisioning, starting, or stopping the g6e box; any AWS CLI mutation; pushing any Docker image; running a migration against a non-local DB. Commits and AWS actions in this plan are performed by the human/executor.

---

## File Structure

New and modified files, each with one responsibility.

**Backend (TypeScript, testable locally, no AWS spend):**
- `backend/src/media/video/constants.ts` (MODIFY) - Wan-native constants: 16 fps, 4n+1 frame math, 480p/720p sizes, Lightning vs full-step presets, `POPPY_WAN_URL` env. Owns all video tunables.
- `backend/src/media/video/frames.ts` (CREATE) - pure frame-count/duration math on the 4n+1 grid. One responsibility: convert seconds <-> frame count.
- `backend/src/inference/videoEndpoint.ts` (CREATE) - resolve/wake the video box base URL (static or router). Mirrors `poppyEndpoint.ts`. Separate resolver for a separate box.
- `backend/src/media/video/workflow.ts` (CREATE) - build the Wan two-expert ComfyUI graph (T2V and I2V, Lightning vs full-step). Pure function, no I/O.
- `backend/src/media/video/providers.ts` (MODIFY) - add `generateWithComfyWan()` as the primary attempt in `generateVideo()`, ahead of Fal/Replicate.
- `backend/src/media/handlers/video.ts` (CREATE) - the `video` queue-job handler: load character, safety, build prompt, resolve I2V reference frame, call provider, return `HandlerOutput`.
- `backend/src/media/handlers/index.ts` (MODIFY) - register `video` in the `handlers` map.
- `backend/src/chat/intent.ts` (MODIFY) - additive video-request intent detection alongside the existing image intent.
- `backend/src/media/video/enqueue.ts` (CREATE) - the start-on-enqueue trigger: call the video router `/wake` when a video job is enqueued.

**Infra (shell + Lambda, APPROVAL-GATED to run):**
- `Plans/inference-video-aws/config.sh` (CREATE) - single source of truth: g6e.xlarge, eu-north-1, EBS >=200GB gp3, ComfyUI :8188, Wan model + LoRA URLs, own router token + budget alarm, `ENABLE_IDLE_STOP="true"`.
- `Plans/inference-video-aws/user-data.sh` (CREATE) - install ComfyUI (Docker), download Wan A14B fp8 experts + umt5 + VAE + Lightning LoRAs to persistent EBS, systemd unit, pre-warm hook.
- `Plans/inference-video-aws/10-deploy.sh` (CREATE) - provision VPC/SG/instance (cloned from inference-aws).
- `Plans/inference-video-aws/20-start.sh` / `30-stop.sh` / `destroy.sh` (CREATE) - lifecycle.
- `Plans/inference-video-aws/router/lambda_function.py` (CREATE) - `/wake` `/status` `/sleep` + idle auto-stop.
- `Plans/inference-video-aws/README.md` (CREATE) - the approval-gated bring-up + e2e test checklist.

---

## Task 1: Wan frame math (frames.ts)

Pure math first: Wan is 16 fps native and accepts frame counts on the `4n+1` grid (81 = 5s). This is the smallest testable unit and everything else depends on it.

**Files:**
- Create: `backend/src/media/video/frames.ts`
- Test: `backend/src/media/video/frames.test.ts`

**Interfaces:**
- Produces: `secondsToFrames(seconds: number, fps: number): number` (rounds to nearest valid `4n+1`), `framesToSeconds(frames: number, fps: number): number`, `clampSeconds(seconds: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/video/frames.test.ts
import { describe, it, expect } from "vitest";
import { secondsToFrames, framesToSeconds, clampSeconds } from "./frames";

describe("wan frame math", () => {
  it("maps 5s at 16fps to 81 frames (4n+1)", () => {
    expect(secondsToFrames(5, 16)).toBe(81);
  });
  it("always returns a 4n+1 frame count", () => {
    for (let s = 1; s <= 10; s++) {
      const f = secondsToFrames(s, 16);
      expect((f - 1) % 4).toBe(0);
    }
  });
  it("framesToSeconds inverts within one frame", () => {
    expect(framesToSeconds(81, 16)).toBeCloseTo(5, 1);
  });
  it("clampSeconds bounds to [1,10]", () => {
    expect(clampSeconds(0)).toBe(1);
    expect(clampSeconds(99)).toBe(10);
    expect(clampSeconds(5)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/video/frames.test.ts`
Expected: FAIL, "Failed to resolve import ./frames" / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/video/frames.ts
// Wan 2.2 accepts frame counts on the 4n+1 grid (e.g. 81 = 5s at 16fps).
// These helpers keep every caller on that grid so ComfyUI never rejects a job.

export function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 1;
  return Math.min(10, Math.max(1, Math.round(seconds)));
}

export function secondsToFrames(seconds: number, fps: number): number {
  const raw = clampSeconds(seconds) * fps;
  // Snap to the nearest 4n+1 value.
  const n = Math.round((raw - 1) / 4);
  return n * 4 + 1;
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/video/frames.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/video/frames.ts backend/src/media/video/frames.test.ts
git commit -m "feat(video): add Wan 4n+1 frame math helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Video constants for Wan (constants.ts)

Replace the placeholder cloud-only constants with Wan-native values and the self-hosted endpoint + step presets.

**Files:**
- Modify: `backend/src/media/video/constants.ts:1-23`
- Test: `backend/src/media/video/constants.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `VIDEO_FPS = 16`; `VIDEO_SIZES = { p480: {width:832,height:480}, p720: {width:1280,height:720} }`; `VIDEO_DEFAULT_QUALITY: "p480"`; `WAN_STEPS = { lightning: { high: 4, low: 4, cfg: 1.0 }, full: { high: 20, low: 20, cfg: 3.5 } }`; `WAN_SHIFT = 5`; `videoSelfHostConfigured(): boolean` (true when `POPPY_WAN_URL` or `POPPY_VIDEO_ROUTER_URL` set). Keeps existing `FAL_VIDEO_MODEL`, `REPLICATE_VIDEO_MODEL`, `VIDEO_DEFAULT_SECONDS`, `VIDEO_MAX_SECONDS`, `SAFETY_NEGATIVE` re-export.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/video/constants.test.ts
import { describe, it, expect } from "vitest";
import {
  VIDEO_FPS,
  VIDEO_SIZES,
  WAN_STEPS,
  videoSelfHostConfigured,
} from "./constants";

describe("video constants (Wan)", () => {
  it("uses Wan-native 16 fps", () => {
    expect(VIDEO_FPS).toBe(16);
  });
  it("offers 480p and 720p sizes", () => {
    expect(VIDEO_SIZES.p480).toEqual({ width: 832, height: 480 });
    expect(VIDEO_SIZES.p720).toEqual({ width: 1280, height: 720 });
  });
  it("lightning preset is few-step, cfg 1.0", () => {
    expect(WAN_STEPS.lightning.high + WAN_STEPS.lightning.low).toBeLessThanOrEqual(8);
    expect(WAN_STEPS.lightning.cfg).toBe(1.0);
  });
  it("self-host is configured when POPPY_WAN_URL is set", () => {
    const prev = process.env.POPPY_WAN_URL;
    process.env.POPPY_WAN_URL = "http://1.2.3.4:8188";
    expect(videoSelfHostConfigured()).toBe(true);
    process.env.POPPY_WAN_URL = prev;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/video/constants.test.ts`
Expected: FAIL, `VIDEO_FPS` is 24 / `VIDEO_SIZES` undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/video/constants.ts
// Video-generation constants. Wan 2.2 A14B is the self-hosted primary; Fal and
// Replicate remain cloud fallbacks. Wan is 16 fps native and frames follow the
// 4n+1 grid (see frames.ts). The 18+ safety negative matches the image pipeline.

import { SAFETY_NEGATIVE } from "../image/constants";

export { SAFETY_NEGATIVE };

export const VIDEO_DEFAULT_SECONDS = 5;
export const VIDEO_MAX_SECONDS = 10;
export const VIDEO_FPS = 16; // Wan 2.2 native

export const VIDEO_SIZES = {
  p480: { width: 832, height: 480 },
  p720: { width: 1280, height: 720 },
} as const;
export type VideoQuality = keyof typeof VIDEO_SIZES;
export const VIDEO_DEFAULT_QUALITY: VideoQuality = "p480";

// Sampling presets for the two-expert schedule. Lightning uses the LightX2V
// distill LoRAs (few steps, cfg 1.0) and is the production default; full is the
// slow hero path.
export const WAN_STEPS = {
  lightning: { high: 4, low: 4, cfg: 1.0 },
  full: { high: 20, low: 20, cfg: 3.5 },
} as const;
export const WAN_SHIFT = 5;

// Cloud fallback model slugs (unchanged). Empty means "skip this provider".
export const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL ?? "";
export const REPLICATE_VIDEO_MODEL = process.env.REPLICATE_VIDEO_MODEL ?? "";

// True when the self-hosted Wan box is reachable (static URL or router).
export function videoSelfHostConfigured(): boolean {
  return Boolean(process.env.POPPY_WAN_URL || process.env.POPPY_VIDEO_ROUTER_URL);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/video/constants.test.ts`
Expected: PASS. Also run `npx vitest run backend/src/media/video/` to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/video/constants.ts backend/src/media/video/constants.test.ts
git commit -m "feat(video): Wan-native constants (16fps, 480p/720p, step presets)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Video box endpoint resolver (videoEndpoint.ts)

Mirror `poppyEndpoint.ts` for a SEPARATE box. Static `POPPY_WAN_URL` override or router (`POPPY_VIDEO_ROUTER_URL` + `POPPY_VIDEO_ROUTER_TOKEN`) with wake/poll/cache.

**Files:**
- Create: `backend/src/inference/videoEndpoint.ts`
- Test: `backend/src/inference/videoEndpoint.test.ts`
- Reference (read, do not edit): `backend/src/inference/poppyEndpoint.ts`

**Interfaces:**
- Produces: `videoConfigured(): boolean`, `resolveVideoBaseUrl(): Promise<string>` (returns `scheme://host:8188`, no trailing slash), `_resetVideoEndpointCache(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/inference/videoEndpoint.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { videoConfigured, resolveVideoBaseUrl, _resetVideoEndpointCache } from "./videoEndpoint";

describe("videoEndpoint", () => {
  beforeEach(() => {
    _resetVideoEndpointCache();
    delete process.env.POPPY_WAN_URL;
    delete process.env.POPPY_VIDEO_ROUTER_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is not configured when neither env is set", () => {
    expect(videoConfigured()).toBe(false);
  });

  it("returns the static URL without trailing slash", async () => {
    process.env.POPPY_WAN_URL = "http://10.0.0.5:8188/";
    expect(videoConfigured()).toBe(true);
    expect(await resolveVideoBaseUrl()).toBe("http://10.0.0.5:8188");
  });

  it("wakes via the router and returns host:8188", async () => {
    process.env.POPPY_VIDEO_ROUTER_URL = "https://router.example";
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ready", ip: "9.9.9.9" }), { status: 200 }),
    );
    expect(await resolveVideoBaseUrl()).toBe("http://9.9.9.9:8188");
    expect(fetchMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/inference/videoEndpoint.test.ts`
Expected: FAIL, cannot resolve `./videoEndpoint`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/inference/videoEndpoint.ts
// Resolver for the dedicated Wan 2.2 video box (ComfyUI on :8188). Separate box
// and separate router from the Stheno/Juggernaut resolver in poppyEndpoint.ts.
// Scale-to-zero: the box may be stopped and its public IP changes on each start.

const VIDEO_PORT = 8188;
const IP_TTL_MS = 60_000;
const WAKE_TIMEOUT_MS = 240_000; // A14B cold start (boot + big model load) up to 4 min
const WAKE_POLL_MS = 5_000;

let cachedIp: string | null = null;
let cachedAt = 0;

export function videoConfigured(): boolean {
  return Boolean(process.env.POPPY_WAN_URL || process.env.POPPY_VIDEO_ROUTER_URL);
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`video_router_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function routerUrl(path: string): string {
  const base = (process.env.POPPY_VIDEO_ROUTER_URL ?? "").replace(/\/$/, "");
  const token = process.env.POPPY_VIDEO_ROUTER_TOKEN ?? "";
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

interface WakeResponse {
  status?: string;
  state?: string;
  ip?: string | null;
}

async function ensureAwakeIp(): Promise<string> {
  if (cachedIp && Date.now() - cachedAt < IP_TTL_MS) return cachedIp;
  const wake = (await fetchJson(routerUrl("/wake"))) as WakeResponse;
  if (wake.status === "ready" && wake.ip) {
    cachedIp = wake.ip;
    cachedAt = Date.now();
    return wake.ip;
  }
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
    const st = (await fetchJson(routerUrl("/status")).catch(() => ({}))) as WakeResponse;
    if (st.state === "running" && st.ip) {
      cachedIp = st.ip;
      cachedAt = Date.now();
      return st.ip;
    }
  }
  throw new Error("video_wake_timeout");
}

export async function resolveVideoBaseUrl(): Promise<string> {
  const staticUrl = process.env.POPPY_WAN_URL;
  if (staticUrl) return staticUrl.replace(/\/$/, "");
  if (!process.env.POPPY_VIDEO_ROUTER_URL) throw new Error("video_not_configured");
  const ip = await ensureAwakeIp();
  return `http://${ip}:${VIDEO_PORT}`;
}

export function _resetVideoEndpointCache(): void {
  cachedIp = null;
  cachedAt = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/inference/videoEndpoint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/inference/videoEndpoint.ts backend/src/inference/videoEndpoint.test.ts
git commit -m "feat(video): add videoEndpoint resolver for the Wan box

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wan two-expert workflow builder (workflow.ts)

Pure function that builds the ComfyUI graph for Wan 2.2 A14B: two `KSamplerAdvanced` nodes (high-noise expert early steps, low-noise expert late steps), umt5 text encode, Wan VAE, optional Lightning LoRAs per expert, T2V vs I2V input.

**Files:**
- Create: `backend/src/media/video/workflow.ts`
- Test: `backend/src/media/video/workflow.test.ts`
- Reference (read): `backend/src/media/image/providers.ts` (ComfyUI graph JSON shape)

**Interfaces:**
- Consumes: `WAN_STEPS`, `WAN_SHIFT`, `VIDEO_SIZES`, `VIDEO_FPS` from constants; `secondsToFrames` from frames.
- Produces: `buildWanWorkflow(a: WanWorkflowArgs): Record<string, unknown>` where
  ```ts
  interface WanWorkflowArgs {
    mode: "t2v" | "i2v";
    positive: string;
    negative: string;
    quality: "p480" | "p720";
    seconds: number;
    seed: number;
    preset: "lightning" | "full";
    refImageName?: string; // required when mode === "i2v"
    highModel: string; low Model?: never; // see below
  }
  ```
  (Concrete arg names are defined in Step 3; the test asserts graph shape.)

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/video/workflow.test.ts
import { describe, it, expect } from "vitest";
import { buildWanWorkflow } from "./workflow";

const base = {
  positive: "a woman waving",
  negative: "blurry",
  quality: "p480" as const,
  seconds: 5,
  seed: 42,
};

describe("buildWanWorkflow", () => {
  it("t2v lightning uses two samplers and no image loader", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "lightning" });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.filter((c) => c === "KSamplerAdvanced")).toHaveLength(2);
    expect(classes).not.toContain("LoadImage");
    // Lightning applies LoRAs to both experts.
    expect(classes.filter((c) => c === "LoraLoaderModelOnly").length).toBeGreaterThanOrEqual(2);
  });

  it("i2v requires and wires a reference image", () => {
    const g = buildWanWorkflow({ ...base, mode: "i2v", preset: "lightning", refImageName: "ref.png" });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("LoadImage");
  });

  it("i2v without a reference image throws", () => {
    expect(() => buildWanWorkflow({ ...base, mode: "i2v", preset: "lightning" })).toThrow();
  });

  it("full preset applies no Lightning LoRAs and higher step count", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "full" });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.filter((c) => c === "LoraLoaderModelOnly")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/video/workflow.test.ts`
Expected: FAIL, cannot resolve `./workflow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/video/workflow.ts
// Build the ComfyUI graph for Wan 2.2 A14B. The A14B model is a two-expert MoE:
// the high-noise expert denoises the early steps, then hands the latent to the
// low-noise expert for the late steps. Lightning (LightX2V distill LoRAs) cut
// the step count and set cfg 1.0; the full preset skips the LoRAs.

import { WAN_STEPS, WAN_SHIFT, VIDEO_SIZES, VIDEO_FPS } from "./constants";
import { secondsToFrames } from "./frames";

// Model file names on the box (see Plans/inference-video-aws/config.sh).
const MODELS = {
  t2vHigh: process.env.WAN_T2V_HIGH ?? "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
  t2vLow: process.env.WAN_T2V_LOW ?? "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
  i2vHigh: process.env.WAN_I2V_HIGH ?? "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  i2vLow: process.env.WAN_I2V_LOW ?? "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  vae: process.env.WAN_VAE ?? "wan_2.1_vae.safetensors",
  clip: process.env.WAN_CLIP ?? "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  loraHigh: process.env.WAN_LORA_HIGH ?? "wan2.2_lightning_high_noise.safetensors",
  loraLow: process.env.WAN_LORA_LOW ?? "wan2.2_lightning_low_noise.safetensors",
} as const;

export interface WanWorkflowArgs {
  mode: "t2v" | "i2v";
  positive: string;
  negative: string;
  quality: keyof typeof VIDEO_SIZES;
  seconds: number;
  seed: number;
  preset: "lightning" | "full";
  refImageName?: string;
}

export function buildWanWorkflow(a: WanWorkflowArgs): Record<string, unknown> {
  if (a.mode === "i2v" && !a.refImageName) throw new Error("i2v_requires_reference");
  const size = VIDEO_SIZES[a.quality];
  const frames = secondsToFrames(a.seconds, VIDEO_FPS);
  const highModel = a.mode === "t2v" ? MODELS.t2vHigh : MODELS.i2vHigh;
  const lowModel = a.mode === "t2v" ? MODELS.t2vLow : MODELS.i2vLow;
  const steps = WAN_STEPS[a.preset];
  const totalSteps = steps.high + steps.low;
  const useLora = a.preset === "lightning";

  const g: Record<string, unknown> = {};

  // Text encoder + prompts.
  g["10"] = { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "wan" } };
  g["11"] = { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: ["10", 0] } };
  g["12"] = { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: ["10", 0] } };
  g["13"] = { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } };

  // High + low expert model loaders.
  g["20"] = { class_type: "UNETLoader", inputs: { unet_name: highModel, weight_dtype: "fp8_e4m3fn" } };
  g["21"] = { class_type: "UNETLoader", inputs: { unet_name: lowModel, weight_dtype: "fp8_e4m3fn" } };

  // Optional Lightning LoRAs applied per expert.
  let highModelRef: [string, number] = ["20", 0];
  let lowModelRef: [string, number] = ["21", 0];
  if (useLora) {
    g["30"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["20", 0], lora_name: MODELS.loraHigh, strength_model: 1.0 },
    };
    g["31"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["21", 0], lora_name: MODELS.loraLow, strength_model: 1.0 },
    };
    highModelRef = ["30", 0];
    lowModelRef = ["31", 0];
  }

  // Latent source: T2V from an empty video latent, I2V from a reference frame.
  if (a.mode === "i2v") {
    g["40"] = { class_type: "LoadImage", inputs: { image: a.refImageName } };
    g["41"] = {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["11", 0], negative: ["12", 0], vae: ["13", 0],
        width: size.width, height: size.height, length: frames, batch_size: 1,
        start_image: ["40", 0],
      },
    };
  } else {
    g["41"] = {
      class_type: "Wan22ImageToVideoLatent",
      inputs: { width: size.width, height: size.height, length: frames, batch_size: 1, vae: ["13", 0] },
    };
  }
  // Both branches expose their conditioning + latent at node 41. For T2V we
  // still route the raw text conditioning; for I2V node 41 re-emits it.
  const posCond: [string, number] = a.mode === "i2v" ? ["41", 0] : ["11", 0];
  const negCond: [string, number] = a.mode === "i2v" ? ["41", 1] : ["12", 0];
  const latent: [string, number] = a.mode === "i2v" ? ["41", 2] : ["41", 0];

  // High-noise expert: steps 0..high (return_with_leftover_noise).
  g["50"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelRef, shift: WAN_SHIFT },
  };
  g["51"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "enable", noise_seed: a.seed, steps: totalSteps, cfg: steps.cfg,
      sampler_name: "euler", scheduler: "simple",
      start_at_step: 0, end_at_step: steps.high, return_with_leftover_noise: "enable",
      model: ["50", 0], positive: posCond, negative: negCond, latent_image: latent,
    },
  };
  // Low-noise expert: steps high..total.
  g["52"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelRef, shift: WAN_SHIFT },
  };
  g["53"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "disable", noise_seed: a.seed, steps: totalSteps, cfg: steps.cfg,
      sampler_name: "euler", scheduler: "simple",
      start_at_step: steps.high, end_at_step: totalSteps, return_with_leftover_noise: "disable",
      model: ["52", 0], positive: posCond, negative: negCond, latent_image: ["51", 0],
    },
  };

  g["60"] = { class_type: "VAEDecode", inputs: { samples: ["53", 0], vae: ["13", 0] } };
  g["61"] = {
    class_type: "SaveWEBM",
    inputs: { images: ["60", 0], filename_prefix: "poppy-wan", fps: VIDEO_FPS, codec: "vp9" },
  };
  return g;
}
```

Note for the executor: exact Wan node `class_type` names (`WanImageToVideo`, `Wan22ImageToVideoLatent`, `SaveWEBM`) must be verified against the ComfyUI version installed on the box during Task 9 bring-up; if a name differs, update the builder and re-run this file's tests (the tests assert structure, not the box). This is why the box e2e is a separate, later task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/video/workflow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/video/workflow.ts backend/src/media/video/workflow.test.ts
git commit -m "feat(video): Wan 2.2 two-expert ComfyUI workflow builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Self-hosted Wan provider + chain ordering (providers.ts)

Add `generateWithComfyWan()` (mirrors the image `generateWithComfyUI` submit/poll/download pattern) and insert it as the PRIMARY attempt in `generateVideo()`, ahead of Fal then Replicate.

**Files:**
- Modify: `backend/src/media/video/providers.ts` (add provider, extend `generateVideo`, extend `GenerateResult.provider` union with `"comfywan"`)
- Test: `backend/src/media/video/providers.test.ts`

**Interfaces:**
- Consumes: `resolveVideoBaseUrl`, `videoConfigured` from `../../inference/videoEndpoint`; `buildWanWorkflow` from `./workflow`; `videoSelfHostConfigured`, `VIDEO_DEFAULT_QUALITY` from `./constants`.
- Produces: `generateWithComfyWan(p: WanParams): Promise<GenerateResult>` and an updated `generateVideo()` whose attempt order is `[comfywan?, fal?, replicate?]`. `WanParams = { mode: "t2v"|"i2v"; prompt; negativePrompt; seconds; seed?; quality?; preset?; referenceImageUrls: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/video/providers.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateVideo, _resetVideoDisabled } from "./providers";
import * as endpoint from "../../inference/videoEndpoint";

describe("generateVideo provider ordering", () => {
  beforeEach(() => {
    _resetVideoDisabled();
    process.env.POPPY_WAN_URL = "http://box:8188";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.POPPY_WAN_URL;
  });

  it("tries the self-hosted Wan box first when configured", async () => {
    vi.spyOn(endpoint, "resolveVideoBaseUrl").mockResolvedValue("http://box:8188");
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: "p1" }), { status: 200 });
      }
      if (String(url).includes("/history/")) {
        return new Response(
          JSON.stringify({ p1: { outputs: { "61": { gifs: [{ filename: "a.webm", type: "output" }] } } } }),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const out = await generateVideo({
      mode: "t2v",
      prompt: "hi",
      negativePrompt: "blur",
      referenceImageUrls: [],
    });
    expect(out.provider).toBe("comfywan");
    expect(calls.some((c) => c.endsWith("/prompt"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/video/providers.test.ts`
Expected: FAIL, `out.provider` is not `"comfywan"` (provider not implemented).

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/media/video/providers.ts` (imports at top, provider function, and edit `generateVideo`). Show the additions:

```ts
import { resolveVideoBaseUrl, videoConfigured } from "../../inference/videoEndpoint";
import { buildWanWorkflow } from "./workflow";
import { VIDEO_DEFAULT_QUALITY, videoSelfHostConfigured, type VideoQuality } from "./constants";

// widen the result union
// interface GenerateResult { provider: "fal" | "replicate" | "comfywan"; ... }

interface WanParams {
  mode: "t2v" | "i2v";
  prompt: string;
  negativePrompt: string;
  seconds: number;
  seed?: number;
  quality?: VideoQuality;
  preset?: "lightning" | "full";
  referenceImageUrls: string[];
}

interface ComfyVideoRef { filename: string; subfolder?: string; type?: string }

async function generateWithComfyWan(p: WanParams): Promise<GenerateResult> {
  const base = await resolveVideoBaseUrl();
  const start = performance.now();
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000_000_000);
  const quality = p.quality ?? VIDEO_DEFAULT_QUALITY;
  const preset = p.preset ?? "lightning";

  let refName: string | undefined;
  if (p.mode === "i2v") {
    const src = p.referenceImageUrls[0];
    if (!src) throw new Error("comfywan_i2v_no_reference");
    const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    const fd = new FormData();
    fd.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "wan-ref.png");
    fd.append("overwrite", "true");
    const up = await fetch(`${base}/upload/image`, { method: "POST", body: fd });
    if (!up.ok) throw new Error(`comfywan_upload_${up.status}`);
    refName = ((await up.json()) as { name?: string }).name;
    if (!refName) throw new Error("comfywan_upload_no_name");
  }

  const workflow = buildWanWorkflow({
    mode: p.mode, positive: p.prompt, negative: p.negativePrompt,
    quality, seconds: p.seconds, seed, preset, refImageName: refName,
  });
  const q = await fetch(`${base}/prompt`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `poppy-wan-${Date.now()}` }),
  });
  if (!q.ok) throw new Error(`comfywan_${q.status}`);
  const { prompt_id: promptId } = (await q.json()) as { prompt_id?: string };
  if (!promptId) throw new Error("comfywan_no_prompt_id");

  // Poll /history. Video jobs take minutes; poll for up to ~20 min.
  let ref: ComfyVideoRef | undefined;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const h = await fetch(`${base}/history/${promptId}`);
    if (!h.ok) continue;
    const hist = (await h.json()) as Record<string, { outputs?: Record<string, { gifs?: ComfyVideoRef[]; images?: ComfyVideoRef[] }> }>;
    const outputs = hist[promptId]?.outputs;
    if (outputs) {
      for (const nodeId of Object.keys(outputs)) {
        const media = outputs[nodeId].gifs ?? outputs[nodeId].images;
        if (media && media.length > 0) { ref = media[0]; break; }
      }
    }
    if (ref) break;
  }
  if (!ref) throw new Error("comfywan_timeout");
  const view =
    `${base}/view?filename=${encodeURIComponent(ref.filename)}` +
    `&subfolder=${encodeURIComponent(ref.subfolder ?? "")}` +
    `&type=${encodeURIComponent(ref.type ?? "output")}`;
  const buffer = await fetchVideo(view);
  return { buffer, provider: "comfywan", latencyMs: Math.round(performance.now() - start), meta: { seed, mode: p.mode, preset, quality } };
}
```

Then edit `generateVideo()` so the attempt list puts Wan first:

```ts
export async function generateVideo(
  p: (Omit<WanParams, "seconds"> & { seconds?: number }),
): Promise<GenerateResult> {
  const params: WanParams = { ...p, seconds: p.seconds ?? VIDEO_DEFAULT_SECONDS };
  const attempts: Array<() => Promise<GenerateResult>> = [];
  if (videoSelfHostConfigured() && videoConfigured()) attempts.push(() => generateWithComfyWan(params));
  if (!disabled.fal) attempts.push(() => generateWithFal(params as unknown as Parameters<typeof generateWithFal>[0]));
  if (!disabled.replicate) attempts.push(() => generateWithReplicate(params as unknown as Parameters<typeof generateWithReplicate>[0]));
  if (attempts.length === 0) throw new VideoNotConfiguredError();
  let lastErr: unknown = new VideoNotConfiguredError();
  for (const attempt of attempts) {
    try { return await attempt(); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}
```

(Keep the existing `GenerateParams` used by Fal/Replicate; only the exported `generateVideo` signature and result union change. Adjust the Fal/Replicate calls to read `mode`/`quality` gracefully.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/video/providers.test.ts`
Expected: PASS. Also `npx vitest run backend/src/media/video/` for the whole module.

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/video/providers.ts backend/src/media/video/providers.test.ts
git commit -m "feat(video): self-hosted Wan provider as primary in generateVideo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Video queue handler (handlers/video.ts) + registration

Mirror `handlers/image.ts`. Load the character, assert adult, build the prompt, resolve the I2V reference frame from `CharacterMedia`, call `generateVideo`, return `HandlerOutput`. Register `video` in the handlers map. The worker already routes `data.kind === "video"` for quota; it just needs a handler.

**Files:**
- Create: `backend/src/media/handlers/video.ts`
- Modify: `backend/src/media/handlers/index.ts` (add `video`)
- Test: `backend/src/media/handlers/video.test.ts`
- Reference (read): `backend/src/media/handlers/image.ts`, `backend/src/media/handlers/index.ts`, `backend/src/queue/media-worker.ts`

**Interfaces:**
- Consumes: `generateVideo` from `../video/providers`; `HandlerOutput`, `MediaJobData` types; `getSignedUrl` from `../storage`; `assertCharacterAdult` from `../image/safety`; `prisma`.
- Produces: `videoHandler(job: MediaJobData): Promise<HandlerOutput>`; `handlers.video` registered.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/handlers/video.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: {
      findUnique: vi.fn().mockResolvedValue({
        id: "c1", style: "realistic", isAdult: true,
        media: [{ url: "media/c1/ref.png", kind: "image" }],
        currentVersion: { appearanceSheet: { stylePrompt: "p", negativePrompt: "n", traits: {}, referenceImageKeys: ["media/c1/ref.png"] } },
      }),
    },
  },
}));
vi.mock("../storage", () => ({ getSignedUrl: vi.fn().mockResolvedValue("https://signed/ref.png") }));
vi.mock("../image/safety", () => ({ assertCharacterAdult: vi.fn(), rejectMinorReference: vi.fn(), ImageSafetyError: class extends Error {} }));
vi.mock("../video/providers", () => ({
  generateVideo: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), provider: "comfywan", latencyMs: 10, meta: {} }),
}));

import { videoHandler } from "./video";
import { generateVideo } from "../video/providers";

describe("videoHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  it("resolves an I2V reference frame and returns an mp4/webm buffer", async () => {
    const out = await videoHandler({
      kind: "video", userId: "u1", characterId: "c1", mediaAssetId: "m1",
      tokenCost: 10, payload: { mode: "i2v", userRequest: "wave hello" },
    } as never);
    expect((generateVideo as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ mode: "i2v" });
    expect(out.buffer).toBeInstanceOf(Buffer);
    expect(out.contentType).toMatch(/video\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/handlers/video.test.ts`
Expected: FAIL, cannot resolve `./video`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/handlers/video.ts
// Video job handler. Mirrors image.ts: load the pinned character, assert adult,
// build a prompt, then call the video provider chain (Wan self-host -> cloud).
// I2V uses the character's existing consistent image as the input frame so the
// clip inherits the image-consistency lock; T2V uses the prompt only.

import { prisma } from "@buttercupp/database";
import type { MediaJobData } from "@buttercupp/shared";
import type { HandlerOutput } from "./index";
import { generateVideo } from "../video/providers";
import { buildImagePrompt } from "../image/prompt";
import { assertCharacterAdult, rejectMinorReference } from "../image/safety";
import { getSignedUrl } from "../storage";

export const videoHandler = async (job: MediaJobData): Promise<HandlerOutput> => {
  if (!job.characterId) throw new Error("video_missing_character");
  const character = await prisma.character.findUnique({
    where: { id: job.characterId },
    include: { currentVersion: { include: { appearanceSheet: true } } },
  });
  if (!character || !character.currentVersion?.appearanceSheet) {
    throw new Error("video_character_or_sheet_missing");
  }
  assertCharacterAdult(character);

  const userRequest = typeof job.payload.userRequest === "string" ? job.payload.userRequest : "";
  rejectMinorReference(userRequest);
  const mode = job.payload.mode === "t2v" ? "t2v" : "i2v";

  const sheet = character.currentVersion.appearanceSheet;
  const style = character.style === "threeD" ? "3d" : (character.style as "realistic" | "anime");
  const { prompt, negativePrompt } = buildImagePrompt({
    appearanceSheet: {
      stylePrompt: sheet.stylePrompt,
      negativePrompt: sheet.negativePrompt,
      traits: sheet.traits as Record<string, unknown> as {
        hair?: string; eye?: string; body?: string; features?: string[]; clothing?: string;
      },
    },
    style,
    userRequest,
  });

  const referenceImageUrls: string[] = [];
  if (mode === "i2v") {
    for (const key of sheet.referenceImageKeys.slice(0, 1)) {
      try { referenceImageUrls.push(await getSignedUrl(key, 5 * 60)); } catch { /* non-fatal */ }
    }
  }

  const seed = typeof job.payload.seed === "number" ? (job.payload.seed as number) : Math.floor(Math.random() * 1_000_000_000);
  const out = await generateVideo({ mode, prompt, negativePrompt, referenceImageUrls, seed });

  return {
    buffer: out.buffer,
    contentType: "video/webm",
    meta: { provider: out.provider, latencyMs: out.latencyMs, seed, mode, ...out.meta },
  };
};
```

Register it:

```ts
// backend/src/media/handlers/index.ts  (add to the handlers map)
import { videoHandler } from "./video";
// handlers = { image: imageHandler, voice: voiceHandler, video: videoHandler }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/handlers/video.test.ts`
Expected: PASS. Also confirm the worker path builds: `npx tsc -p backend --noEmit` (or the repo build command).

- [ ] **Step 5: Commit**

```bash
git add backend/src/media/handlers/video.ts backend/src/media/handlers/index.ts backend/src/media/handlers/video.test.ts
git commit -m "feat(video): video queue handler + register kind=video

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Video request intent detection (chat/intent.ts)

Additive: detect a video request in chat, distinct from the existing image request. Follow the keyword pattern in `backend/src/chat/__tests__/intent-keyword.test.ts`.

**Files:**
- Modify: `backend/src/chat/intent.ts`
- Test: `backend/src/chat/__tests__/intent-video.test.ts`
- Reference (read): `backend/src/chat/intent.ts`, `backend/src/chat/__tests__/intent-keyword.test.ts`

**Interfaces:**
- Produces: `detectVideoRequest(text: string): { wanted: boolean; mode: "t2v" | "i2v" }` (I2V is the default when the user references "you"/"yourself"; T2V when the scene has no self-reference). Wire it so the existing image-intent path is checked first and video is a separate branch (do not break image detection).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/chat/__tests__/intent-video.test.ts
import { describe, it, expect } from "vitest";
import { detectVideoRequest } from "../intent";

describe("detectVideoRequest", () => {
  it("detects an explicit video request", () => {
    expect(detectVideoRequest("send me a video of you dancing").wanted).toBe(true);
    expect(detectVideoRequest("can you make a short clip waving").wanted).toBe(true);
  });
  it("defaults to i2v when the user references the character", () => {
    expect(detectVideoRequest("a video of you at the beach").mode).toBe("i2v");
  });
  it("does not fire on a plain photo request", () => {
    expect(detectVideoRequest("send me a photo").wanted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/chat/__tests__/intent-video.test.ts`
Expected: FAIL, `detectVideoRequest` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/chat/intent.ts  (add this export; keep existing image intent intact)
const VIDEO_KEYWORDS = /\b(video|clip|gif|animation|animate|moving)\b/i;
const SELF_REF = /\b(you|yourself|your)\b/i;

export function detectVideoRequest(text: string): { wanted: boolean; mode: "t2v" | "i2v" } {
  const wanted = VIDEO_KEYWORDS.test(text);
  const mode = SELF_REF.test(text) ? "i2v" : "t2v";
  return { wanted, mode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/chat/__tests__/intent-video.test.ts`
Expected: PASS. Run the existing intent tests to confirm no regression: `npx vitest run backend/src/chat/__tests__/intent-keyword.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/chat/intent.ts backend/src/chat/__tests__/intent-video.test.ts
git commit -m "feat(video): detect in-chat video requests (i2v default)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Start-on-enqueue trigger (video/enqueue.ts)

When a video job is enqueued, wake the video box via its router so it is booting while the job waits. Best-effort: a wake failure must not block enqueue (the resolver will retry on generate).

**Files:**
- Create: `backend/src/media/video/enqueue.ts`
- Test: `backend/src/media/video/enqueue.test.ts`

**Interfaces:**
- Produces: `wakeVideoBox(): Promise<void>` (calls the router `/wake`, swallows errors, no-op when only a static URL is set). Call it from wherever video jobs are added to the queue (the create/chat enqueue site), after the `MediaAsset` is created.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/media/video/enqueue.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wakeVideoBox } from "./enqueue";

describe("wakeVideoBox", () => {
  beforeEach(() => { delete process.env.POPPY_WAN_URL; process.env.POPPY_VIDEO_ROUTER_URL = "https://r"; });
  afterEach(() => vi.restoreAllMocks());

  it("calls the router /wake when a router is configured", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await wakeVideoBox();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/wake"), expect.anything());
  });
  it("swallows wake errors (never throws)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("boom"));
    await expect(wakeVideoBox()).resolves.toBeUndefined();
  });
  it("is a no-op when only a static URL is set", async () => {
    delete process.env.POPPY_VIDEO_ROUTER_URL;
    process.env.POPPY_WAN_URL = "http://box:8188";
    const fetchMock = vi.spyOn(global, "fetch");
    await wakeVideoBox();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/media/video/enqueue.test.ts`
Expected: FAIL, cannot resolve `./enqueue`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/media/video/enqueue.ts
// Start-on-enqueue: nudge the scale-to-zero video box awake as soon as a video
// job is queued, so it is booting while the job waits. Best-effort only.

export async function wakeVideoBox(): Promise<void> {
  const router = process.env.POPPY_VIDEO_ROUTER_URL;
  if (!router) return; // static URL or unconfigured: nothing to wake
  const token = process.env.POPPY_VIDEO_ROUTER_TOKEN ?? "";
  const base = router.replace(/\/$/, "");
  const url = token ? `${base}/wake?token=${encodeURIComponent(token)}` : `${base}/wake`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  } catch {
    // Non-fatal: the endpoint resolver will wake+poll again at generate time.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/media/video/enqueue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the call + commit**

Call `wakeVideoBox()` at the video enqueue site (the create-flow and chat handlers that add a `kind: "video"` job), immediately after the queue `.add(...)`. Then:

```bash
git add backend/src/media/video/enqueue.ts backend/src/media/video/enqueue.test.ts <enqueue-call-site-file>
git commit -m "feat(video): wake the Wan box on video enqueue (scale-to-zero)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Video GPU box stack (Plans/inference-video-aws/) — APPROVAL-GATED

Clone the `Plans/inference-aws/` numbered-script pattern into a new isolated stack for the Wan box. This task produces files; RUNNING any of them (deploy/start/stop) is APPROVAL-GATED and performed by the human.

**Files:**
- Create: `Plans/inference-video-aws/config.sh`, `user-data.sh`, `10-deploy.sh`, `20-start.sh`, `30-stop.sh`, `destroy.sh`, `router/lambda_function.py`, `README.md`
- Reference (read): all of `Plans/inference-aws/`

**Interfaces:** shell scripts; no TS. "Tests" here are a documented manual bring-up checklist (in README.md) run under human approval.

- [ ] **Step 1: Write `config.sh`** cloned from `inference-aws/config.sh` with these differences (verbatim values):
  - `PROJECT="poppy-inference-video"`, `AWS_REGION="eu-north-1"`.
  - `INSTANCE_TYPE="g6e.xlarge"` (L40S 45GB).
  - `EBS_SIZE_GB="220"` (Wan fp8 experts + LoRAs + umt5 + VAE + Docker, ~30GB weights plus headroom).
  - `OPEN_PORTS=(22 8188)` (ComfyUI only; no LLM on this box).
  - `ENABLE_IDLE_STOP="true"`, `IDLE_MINUTES="12"` (scale-to-zero).
  - `MONTHLY_BUDGET_USD="500"` with alert + `BUDGET_ACTION_PCT="90"`.
  - A distinct `ROUTER_AUTH_TOKEN` (a fresh long random string; do NOT reuse the image box token).
  - Wan model download URLs (Comfy-Org/Wan_2.2_ComfyUI_Repackaged + lightx2v): the four fp8 experts (t2v/i2v x high/low), `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors`, and the two Lightning LoRAs. Each as `WAN_*_URL` + `WAN_*_NAME` pairs matching the `MODELS` names in `workflow.ts`.

- [ ] **Step 2: Write `user-data.sh`** cloned from `inference-aws/user-data.sh`, dropping the Stheno/llama.cpp service entirely. Keep: swapfile, Docker, ComfyUI (`aidockorg/comfyui-cuda:latest`) systemd unit on :8188. Add: download the Wan models + LoRAs into the mounted `models/` subdirs (`diffusion_models/`, `text_encoders/`, `vae/`, `loras/`) on the persistent EBS. Add a pre-warm hook that submits a tiny 1-frame job on boot so both experts load into VRAM before the first real job.

- [ ] **Step 3: Write `10-deploy.sh`, `20-start.sh`, `30-stop.sh`, `destroy.sh`** cloned from the image stack, pointed at the new `config.sh`. `20-start.sh` verifies `:8188/system_stats` responds.

- [ ] **Step 4: Write `router/lambda_function.py`** cloned from `inference-aws/router/lambda_function.py`, targeting this stack's instance tag and its own auth token, with idle auto-stop enabled.

- [ ] **Step 5: Write `README.md`** with the APPROVAL-GATED bring-up checklist:
  1. `source config.sh` and review every value (region, instance type, budget).
  2. (ASK THE USER before running) `bash 10-deploy.sh` to provision.
  3. Wait for `user-data.sh` to finish downloading weights (watch via SSH / console).
  4. `curl http://<ip>:8188/system_stats` returns 200.
  5. Set backend env: `POPPY_VIDEO_ROUTER_URL`, `POPPY_VIDEO_ROUTER_TOKEN` (or `POPPY_WAN_URL` for a pinned test).

- [ ] **Step 6: Commit (no execution)**

```bash
git add Plans/inference-video-aws/
git commit -m "feat(video): isolated g6e Wan inference stack (provision scripts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Do NOT run `10-deploy.sh` or any AWS CLI command in this task. Provisioning is Task 10, under explicit human approval.

---

## Task 10: End-to-end box bring-up + verification — APPROVAL-GATED (manual)

This is the user's explicit "we have to test it". It spends real AWS money and is performed only after the user approves each AWS action.

**Files:** none (operational). Uses Task 9 scripts + the backend from Tasks 1-8.

- [ ] **Step 1: ASK THE USER** for explicit approval to provision the g6e box (this starts billing).
- [ ] **Step 2:** With approval, run `bash Plans/inference-video-aws/10-deploy.sh`; wait for weight download to finish.
- [ ] **Step 3:** Verify ComfyUI: `curl http://<ip>:8188/system_stats` returns 200 and the Wan nodes are present (`curl http://<ip>:8188/object_info | grep -i wan`). If a node `class_type` differs from `workflow.ts` (e.g. the I2V or SaveWEBM node), update `workflow.ts` + re-run its unit tests, commit, redeploy.
- [ ] **Step 4:** Point the backend at the box: set `POPPY_WAN_URL=http://<ip>:8188` locally.
- [ ] **Step 5:** Run one T2V clip and one I2V clip end to end through `generateVideo()` (a small script or a real enqueue). Confirm: a `.webm`/`.mp4` buffer returns, uploads to `POPPY_S3_BUCKET_REELS` via `uploadMedia`, the `MediaAsset` flips to `ready`, the `CharacterMedia` dual-write lands with `kind="video"`, and the clip plays in the reels UI.
- [ ] **Step 6:** Measure clip time (Lightning vs full preset) and confirm the scale-to-zero idle stop halts the box after `IDLE_MINUTES`.
- [ ] **Step 7:** Report results to the user. Enabling video in prod (env on Amplify/ECS) is a SEPARATE approval-gated deploy.

---

## Self-Review

**Spec coverage:** Separate g6e box (Task 9), A14B fp8 two-expert + Lightning default with full fallback (Tasks 2, 4), both I2V and T2V (Tasks 4, 6, 7), videoEndpoint resolver (Task 3), Wan provider ahead of Fal/Replicate (Task 5), video handler + kind registration + reuse of MediaAsset/CharacterMedia/quota (Task 6, worker already routes `video`), reels S3 reuse (Task 6 via `uploadMedia`), chat/create intent (Task 7), scale-to-zero start-on-enqueue + stop-on-idle (Tasks 8, 9), 16fps/4n+1/480p-720p (Tasks 1, 2), cost/idle config (Task 9), e2e box test (Task 10), Apache-2.0 + 18+ negative + NSFW-LoRA-deferred (spec, `SAFETY_NEGATIVE` reused in Task 2). All spec sections map to a task.

**Placeholder scan:** No "TBD"/"TODO". The one deferred verification (exact Wan node `class_type` names) is explicitly assigned to Task 10 Step 3 with a defined remediation, not left vague.

**Type consistency:** `generateVideo` result union `"comfywan"` (Task 5) matches the provider return in Task 5; `WanWorkflowArgs`/`buildWanWorkflow` names match between Tasks 4 and 5; `videoHandler` returns `HandlerOutput` matching the image handler and the worker's `handlers[data.kind](data)` call; `resolveVideoBaseUrl`/`videoConfigured` names match between Tasks 3 and 5.

## Execution Handoff

Handoff options are presented by the orchestrator after both plans are reviewed.
