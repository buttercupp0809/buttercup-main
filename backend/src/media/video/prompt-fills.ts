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
  // Bias toward controlled, natural motion. Subtle motion is both more realistic
  // for an avatar and far more temporally stable than large scene motion (this
  // is why competitor "Live Action" clips look smooth: they keep motion small).
  motionTags: `natural subtle motion, smooth gentle movement, steady stable camera, consistent even lighting, coherent frames`,
  // Fidelity + temporal-stability cues. "temporally stable / consistent lighting"
  // directly counteracts the brightness-pulsing that low-step diffusion produces.
  qualityTags: `high detail, sharp focus, cinematic, film-quality, temporally stable, consistent exposure`,
  // Anti-flicker + anti-warp negatives. The lighting "flashes" the user reported
  // are brightness/exposure flicker and strobing; name them explicitly so the
  // sampler suppresses them, plus the usual identity/warp guards.
  negativeExtra: `flickering, brightness flicker, strobing, exposure shift, flashing lights, warping, morphing, jitter, shaking, duplicated frames, ghosting, identity drift, face distortion, deformed face`,
} as const;
