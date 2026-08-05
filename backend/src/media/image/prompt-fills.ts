// ============================================================================
// IMAGE PROMPT FILL-INS  (edit these strings, nothing else)
// ============================================================================
//
// These feed backend/src/media/image/prompt.ts (buildImagePrompt). They ship
// EMPTY so current behavior and the prompt golden tests are unchanged; paste
// your tuning here and every generated image picks it up.
//
//   qualityTags    -> appended to the POSITIVE prompt (after the scene).
//                     e.g. "masterpiece, best quality, 8k, sharp focus"
//   negativeExtra  -> appended to the NEGATIVE prompt (after the safety block).
//                     e.g. "lowres, watermark, text, deformed hands"
//   styleFlavor    -> optional per-style override of the built-in flavor text.
//                     Leave a value empty to keep the default flavor.

export const IMAGE_PROMPT_FILLS = {
  qualityTags: ``,
  negativeExtra: ``,
  styleFlavor: {
    realistic: ``,
    "3d": ``,
    anime: ``,
  } as Record<"realistic" | "3d" | "anime", string>,
} as const;
