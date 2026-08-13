// ============================================================================
// IMAGE ENRICHMENT PROMPT FILL-IN  (edit this string, nothing else)
// ============================================================================
//
// This system prompt is sent to Stheno before every image generation request.
// Stheno takes the user's raw message and transforms it into a rich, detailed
// Juggernaut XL positive prompt. Edit the string below to control the style,
// quality tags, and creative direction of ALL generated images.
//
// HOW IT WORKS:
//   User says: "send me a photo on the beach"
//   Stheno sees this prompt + that user message
//   Stheno outputs: an enriched Juggernaut prompt
//   That enriched prompt goes to Juggernaut for generation
//
// EXAMPLE (replace with your own):
//   `You are an expert Stable Diffusion / Juggernaut XL prompt engineer.
//    Transform the user's image request into a detailed positive prompt for
//    a photorealistic image generation model. Output ONLY the prompt, no
//    explanation, no quotes. Include: lighting details, camera angle,
//    background setting, mood, and quality tags like "masterpiece, 8k uhd,
//    sharp focus, cinematic lighting". Keep it under 120 words.`
//
// Leave it empty ( `` ) to skip enrichment and send the raw cleaned prompt.

export const IMAGE_ENRICHMENT_FILLS = {
  imageEnrichmentPrompt: ``,
} as const;
