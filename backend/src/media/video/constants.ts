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

// Per-expert sampling + post-processing per preset. The high-noise expert is the
// "motion director"; the Lightning LoRA at FULL strength there flattens motion
// into a slideshow. `loraStrength` (0 = LoRA off) tunes this: balanced weakens it
// to 0.7 (restores motion while staying near Lightning speed, the community
// "3-sampler" recommendation), max drops it entirely to 0 for full-quality (slow)
// diffusion. `interpolate` adds RIFE 2x (Stage C, gated by WAN_INTERPOLATION).
// `hq` renders at the 576p-class VIDEO_ASPECTS_HQ. hq + loraStrength 0 + 8s is the
// heaviest combination (minutes per step); it lives in max only, never balanced.
export const WAN_STEPS = {
  fast: {
    high: { steps: 4, cfg: 1.0, loraStrength: 1.0 },
    low: { steps: 4, cfg: 1.0, loraStrength: 1.0 },
    interpolate: false,
    hq: false,
  },
  balanced: {
    high: { steps: 4, cfg: 3.5, loraStrength: 0.7 },
    low: { steps: 4, cfg: 1.0, loraStrength: 1.0 },
    interpolate: true,
    hq: false,
  },
  max: {
    high: { steps: 8, cfg: 4.0, loraStrength: 0.0 },
    low: { steps: 6, cfg: 3.5, loraStrength: 0.0 },
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
