// LoRA training image captioner.
//
// Captions are mandatory for Kohya SDXL LoRA training. Each caption must START
// with a synthetic per-character trigger token (identity carrier) and then
// describe pose, framing, and background per the kohya convention.
//
// All I/O is injected through the CaptionDeps interface so this module is
// fully unit-testable without hitting the GPU box or any network I/O.
// The caller is responsible for wiring a real VLM captioner in production.

import { createHash } from "crypto";

/** Dependency injection bag for captioning. */
export interface CaptionDeps {
  /** Generate a VLM caption for the given S3 image key. */
  vlmCaption(imageKey: string): Promise<string>;
}

/**
 * Generate a LoRA training caption for an image.
 * Prepends the trigger token to the VLM-generated description.
 * The trigger token must START the caption per kohya SDXL convention.
 */
export async function captionImage(
  { imageKey, triggerToken }: { imageKey: string; triggerToken: string },
  deps: CaptionDeps,
): Promise<string> {
  const description = await deps.vlmCaption(imageKey);
  return `${triggerToken} ${description}`;
}

/**
 * Generate a deterministic trigger token for a character.
 * Format: ch_<8-hex-chars> where hex is derived from a stable hash of characterId.
 * Deterministic so re-runs of the same character produce the same token.
 */
export function makeTriggerToken(characterId: string): string {
  const hash = createHash("sha1").update(characterId).digest("hex").slice(0, 8);
  return `ch_${hash}`;
}
