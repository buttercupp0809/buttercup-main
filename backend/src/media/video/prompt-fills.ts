// ============================================================================
// VIDEO PROMPT FILL-INS  (edit these strings, nothing else)
// ============================================================================
//
// These feed backend/src/media/video/prompt.ts (buildVideoPrompt). They ship
// EMPTY so behavior is inert until you fill them.
//
//   motionTags     -> appended to the POSITIVE prompt to describe motion.
//                     e.g. "smooth camera pan, gentle motion, cinematic"
//   qualityTags    -> appended to the POSITIVE prompt for fidelity.
//                     e.g. "high detail, film grain, 24fps"
//   negativeExtra  -> appended to the NEGATIVE prompt.
//                     e.g. "flickering, warping, jitter, duplicated frames"

export const VIDEO_PROMPT_FILLS = {
  motionTags: ``,
  qualityTags: ``,
  negativeExtra: ``,
} as const;
