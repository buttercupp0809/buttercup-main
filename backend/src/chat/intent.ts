// Message intent classifier. Two-layer design (see
// Plans/cursor-prompt/35-major-fixes-batch.md #D.1):
//
//   1. Fast deterministic keyword FLOOR (`matchImageKeyword`). Recognizes
//      obviously-explicit requests ("send me a photo", "show me a pic",
//      "generate an image") and returns "image" immediately without
//      calling the LLM. This is the safety net for when the GPU box is
//      down / the classifier times out / the classifier returns the
//      hardcoded fallback string.
//
//   2. LLM tie-breaker (`classifyMessageIntent`) for ambiguous phrasing
//      only. Same conservative system prompt as before; still returns
//      "text" on failure, but the keyword floor above means we never
//      silently swallow an explicit request.
//
// The frontend may also pass an EXPLICIT intent (e.g. from a Photo/Video
// pill), in which case neither layer needs to run. See D.2.

export type MessageIntent = "image" | "text" | "video_request";

// Video keyword patterns. Checked BEFORE the image patterns so video
// requests are intercepted at the chat-stream layer and returned as a
// gentle in-character redirect rather than falling into image generation.
const VIDEO_KEYWORD_PATTERNS: RegExp[] = [
  /\b(send|show|share|give|drop|make|film|shoot|create|generate|record)\s+(me\s+)?(a\s+|an\s+|the\s+|your\s+)?(video|clip|vid|movie|reel|short)\b/i,
  /\b(i\s+want|i'?d\s+like|i\s+would\s+like|can\s+i\s+see|could\s+you)\s+(a\s+|an\s+)?(video|clip|vid|movie|reel)\b/i,
  /\bfilm\s+(me|you|yourself|us)\b/i,
  /\bshort\s+film\b/i,
];

export function matchVideoKeyword(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return VIDEO_KEYWORD_PATTERNS.some((re) => re.test(t));
}

// High-precision keyword matcher. Each pattern must match an unambiguous
// image REQUEST. Avoid patterns that trip on casual conversation
// ("that painting is a pretty picture", "picture this...", "I can't
// picture it"). False positives here silently rob the user of chat.
//
// Order matters: earlier patterns are more specific.
const IMAGE_KEYWORD_PATTERNS: RegExp[] = [
  // Imperative "send/show/share/give me a ..."
  /\b(send|show|share|give|drop|snap|take|shoot)\s+(me\s+)?(a\s+|an\s+|the\s+|another\s+|one\s+more\s+)?(pic(ture)?|photo|selfie|image|shot|snap|nude|nudes|video|clip|vid)\b/i,
  // Explicit "generate/make/create a picture/photo/image"
  /\b(generate|make|create|render|produce)\s+(me\s+)?(a\s+|an\s+)?(pic(ture)?|photo|selfie|image|shot|nude|video|clip)\b/i,
  // "Can I see you (naked/in ...)": interpretation is unambiguous.
  /\b(can|could|may)\s+i\s+(see|get\s+a\s+look\s+at)\s+(you|a\s+pic|a\s+photo|an?\s+image)/i,
  // "I want a photo of ..." / "I'd like a picture of ..."
  /\b(i\s+want|i'?d\s+like|i\s+would\s+like)\s+(a\s+|an\s+)?(pic(ture)?|photo|selfie|image|nude|video)\b/i,
  // Standalone imperative: the sentence is JUST the noun (optionally
  // followed by "please/pls" and simple punctuation). Anchoring to ^...$
  // stops "that painting is a pretty picture" (which ends in "picture" but
  // does not stand alone) from being classified as a request.
  /^(selfie|selfies|nude|nudes|pics|pic|photo|photos)\s*(please|pls)?\s*[!.?]?$/i,
  // "another pic please" / "one more photo" / "more pics".
  /\b(another|one\s+more|more)\s+(pic(ture)?s?|photo(s)?|selfie(s)?|nude(s)?)\b/i,
];

// Exported so unit tests can lock the positive + negative sets.
export function matchImageKeyword(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return IMAGE_KEYWORD_PATTERNS.some((re) => re.test(t));
}

// Classify whether a user message is an image request.
//
// KEYWORD-ONLY (instant). The former LLM tie-breaker was removed from the hot
// path: it routed to the self-hosted GPU box first ("mature") with a 1.5s
// abort signal that fired on EVERY message (the box is unreachable from prod),
// adding ~1.5s of dead latency to every single reply for a result that always
// fell back to this same keyword floor anyway. `matchImageKeyword` covers the
// explicit requests, and the frontend Photo pill covers deliberate ones. If a
// nuanced-phrasing tie-breaker is needed later, reintroduce it as a fast
// openrouter-routed call (sub-500ms, its own timeout) rather than blocking the
// turn on the self-hosted box.
export async function classifyMessageIntent(text: string): Promise<MessageIntent> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "text";
  return matchImageKeyword(trimmed) ? "image" : "text";
}
