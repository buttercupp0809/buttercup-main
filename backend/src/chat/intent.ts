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

import { callLLM } from "../llm/provider";
import { logWarn } from "../utils/log";

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

// Hard cap on the classifier round-trip. Kept short so the extra hop before the
// image/text branch never noticeably delays a normal chat turn.
const CLASSIFY_TIMEOUT_MS = 1500;

const SYSTEM_PROMPT =
  "You are an intent classifier for a chat app. Decide whether the user's latest message is " +
  "asking the character to SEND or GENERATE a visual of themselves or a scene: a photo, selfie, " +
  "pic, picture, image, or video that should be delivered to the user. " +
  "Be conservative: only choose \"image\" when the user clearly wants a visual delivered right now " +
  "(e.g. \"send me a selfie\", \"show me a pic\", \"can I see you\", \"generate a photo of you on a beach\"). " +
  "General mentions of the word picture, photo, or image in ordinary conversation are NOT requests " +
  "(e.g. \"that painting is a pretty picture\", \"picture this...\"). " +
  "Respond with strict JSON and nothing else: {\"intent\":\"image\"} or {\"intent\":\"text\"}.";

// Pull the first {...} object out of a possibly-noisy model reply and read its
// `intent` field. Returns null when nothing usable is present.
function parseIntent(raw: string): MessageIntent | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  if (start === -1) return null;
  const end = raw.indexOf("}", start);
  if (end === -1) return null;
  const slice = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as { intent?: unknown };
    if (parsed.intent === "image") return "image";
    if (parsed.intent === "text") return "text";
    return null;
  } catch {
    return null;
  }
}

// Classify whether a user message is an image request. Never throws; the
// keyword floor above catches obvious requests without an LLM call, and
// the LLM tie-breaker defaults to "text" on any failure so the normal
// chat path is the safe fallback for ambiguous phrasing.
export async function classifyMessageIntent(text: string): Promise<MessageIntent> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "text";

  // Deterministic floor. When it fires, skip the LLM entirely: saves the
  // 1500ms round-trip AND removes the box-down failure mode for the
  // obvious explicit requests. See #D.1 in the plan.
  if (matchImageKeyword(trimmed)) return "image";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
  try {
    const result = await callLLM({
      purpose: "extract",
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: trimmed }],
      maxTokens: 16,
      temperature: 0,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      signal: controller.signal,
      // Mature routing so the classifier resolves on this NSFW platform, matching
      // how generateImageTeaser calls callLLM.
      contentRating: "mature",
    });
    // A whole-chain outage returns the hardcoded fallback string, which is
    // not a classification. Fall back to the keyword matcher one more time
    // (redundant for obvious requests, but a belt for edge phrasings) then
    // to "text". The keyword floor above already returned early for the
    // clearly-explicit cases; this branch just makes the fallback path
    // symmetric.
    if (result.provider === "hardcoded") {
      return matchImageKeyword(trimmed) ? "image" : "text";
    }
    return parseIntent(result.text) ?? (matchImageKeyword(trimmed) ? "image" : "text");
  } catch (err) {
    logWarn("intent", `classify failed, defaulting to text: ${err instanceof Error ? err.message : String(err)}`);
    return matchImageKeyword(trimmed) ? "image" : "text";
  } finally {
    clearTimeout(timer);
  }
}
