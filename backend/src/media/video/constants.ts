// Video-generation constants. Mirrors media/image/constants.ts. Model IDs are
// PLACEHOLDERS: fill them with the real hosted model slugs you want to use.
// The safety negative is the same mandatory 18+ guard as the image pipeline.

import { SAFETY_NEGATIVE } from "../image/constants";

export { SAFETY_NEGATIVE };

// Clip length + resolution. Keep short; video tokens are expensive.
export const VIDEO_DEFAULT_SECONDS = 5;
export const VIDEO_MAX_SECONDS = 10;
export const VIDEO_FPS = 24;
export const VIDEO_SIZE = { width: 768, height: 768 } as const;

// FILL ME: hosted text-to-video model slugs per provider. Examples are shown
// as comments; replace the empty strings to enable that provider. An empty
// string means "provider not configured" and it is skipped in the chain.
export const FAL_VIDEO_MODEL =
  process.env.FAL_VIDEO_MODEL ?? ""; // e.g. "fal-ai/wan-t2v" or "fal-ai/ltx-video"

export const REPLICATE_VIDEO_MODEL =
  process.env.REPLICATE_VIDEO_MODEL ?? ""; // e.g. a Wan 2.1 / SVD version hash

// ============================================================================
// Self-hosted Wan 2.2 A14B constants (additive; the cloud constants above are
// untouched so the existing Fal/Replicate providers keep working unchanged).
// ============================================================================

// Wan is 16 fps native (distinct from VIDEO_FPS=24 used by the cloud providers).
export const WAN_FPS = 16;

// Wan aspect-ratio sizes at a 480p base (all dims divisible by 16 so ComfyUI
// never rejects a job). Portrait/landscape/square swap width and height around
// the same 480p budget; there is no separate quality tier anymore.
export const VIDEO_ASPECTS = {
  portrait: { width: 480, height: 832 },
  landscape: { width: 832, height: 480 },
  square: { width: 512, height: 512 },
} as const;
export type VideoAspect = keyof typeof VIDEO_ASPECTS;
export const VIDEO_DEFAULT_ASPECT: VideoAspect = "portrait";

// Per-expert sampling + post-processing per preset.
//
// KEY FIX (2026-08-26): the old balanced/max presets ran the high-noise expert
// at cfg 3.5 WHILE applying the Lightning LoRA (loraStrength 0.7/0.6). Lightning
// is a distilled LoRA trained for cfg approximately 1.0; driving cfg to 3.5
// fights the distillation and produces brightness pulsing / face "flashes" (the
// reported flicker), worst at only 4+4 steps. The recipe now obeys one rule:
//   - Lightning ON  (loraStrength > 0) => cfg MUST be ~1.0 (fast tier).
//   - Full cfg (>1) => Lightning OFF (loraStrength 0), with more steps.
// The quality tiers (balanced/max) therefore drop the LoRA and run real
// diffusion: stable lighting AND actual prompt adherence.
//
// `interpolate` adds RIFE 2x (Stage C, gated by WAN_INTERPOLATION=1) for smoother
// motion. `hq` renders at 720p via VIDEO_ASPECTS_HQ; fast/balanced use 480p.
//
// NOTE: step/cfg values are quality-first STARTING points, tuned via the
// video-quality bench (backend/scripts/video-quality-bench.ts) on the box.
export const WAN_STEPS = {
  // Speed tier: Lightning at its CORRECT cfg (1.0). Fast + stable (no flicker),
  // but lower prompt adherence than the quality tiers. 480p, no interpolation.
  fast: {
    high: { steps: 4, cfg: 1.0, loraStrength: 1.0 },
    low: { steps: 4, cfg: 1.0, loraStrength: 1.0 },
    interpolate: false,
    hq: false,
  },
  // Quality DEFAULT (UI default). No Lightning; full cfg + 6+6 steps for stable
  // lighting and strong adherence. 480p + RIFE smoothing.
  balanced: {
    high: { steps: 6, cfg: 3.5, loraStrength: 0.0 },
    low: { steps: 6, cfg: 3.5, loraStrength: 0.0 },
    interpolate: true,
    hq: false,
  },
  // Max quality: no Lightning, 10+10 steps, slightly higher high-noise cfg for
  // motion fidelity, 720p + RIFE. Heaviest render (needs the 64GB box).
  max: {
    high: { steps: 10, cfg: 4.0, loraStrength: 0.0 },
    low: { steps: 10, cfg: 3.5, loraStrength: 0.0 },
    interpolate: true,
    hq: true,
  },
} as const;
export type WanPreset = keyof typeof WAN_STEPS;
export const WAN_DEFAULT_PRESET: WanPreset = "balanced";
export const WAN_SHIFT = 5;

// True 720p HD dims (all divisible by 16). Used by the hq preset (max) for the
// highest-quality permanent library; fast/balanced keep the lighter
// VIDEO_ASPECTS (480p) for speed. 720p at 8s (129 frames) with no Lightning LoRA
// is the heaviest render we run: validate one clip on the box before a batch.
export const VIDEO_ASPECTS_HQ = {
  portrait: { width: 720, height: 1280 },
  landscape: { width: 1280, height: 720 },
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

// True when the self-hosted Wan box is reachable (static URL or router).
export function videoSelfHostConfigured(): boolean {
  return Boolean(process.env.POPPY_WAN_URL || process.env.POPPY_VIDEO_ROUTER_URL);
}

// Max frame budget the self-hosted box can render WITHOUT running out of host
// RAM. A clip past this OOMs the box during VAE decode and hangs it (proven on
// g6e.xlarge / 32GB RAM: 49 frames / 3s is safe, 129 frames / 8s OOMs). The
// handler fails an over-budget job FAST with a clear message instead of letting
// it wedge the box. Tunable per box: raise WAN_MAX_FRAMES after moving to a
// larger-RAM instance (e.g. g6e.2xlarge / 64GB). Default 81 (~5s at 16fps).
export function videoMaxFrames(): number {
  const n = Number(process.env.WAN_MAX_FRAMES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 81;
}
