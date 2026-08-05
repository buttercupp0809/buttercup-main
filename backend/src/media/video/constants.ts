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
