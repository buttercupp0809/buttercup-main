// LLM-based message intent classifier. Replaces the old regex keyword list
// (media/image/decision.ts::isImageRequest, deleted in this change) with a fast
// classification call on the cheap "extract" tier. It decides whether the user
// is asking the character to SEND or GENERATE a visual of themselves or a scene
// (a photo, selfie, pic, picture, image, or video) so the chat pipeline can
// branch into the image flow.
//
// Design decisions:
//   - Purpose "extract" routes to the fast/cheap model tier (see provider.ts).
//   - Conservative: only "image" when the user clearly wants a visual delivered.
//   - Bounded: small maxTokens + a hard ~1500ms timeout.
//   - Fail-safe: on ANY error, timeout, empty input, or unparseable output we
//     return "text". There is NO keyword/regex fallback anywhere by design.

import { callLLM } from "../llm/provider";
import { logWarn } from "../utils/log";

export type MessageIntent = "image" | "text";

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

// Classify whether a user message is an image request. Never throws; defaults
// to "text" on any failure so the normal chat path is the safe fallback.
export async function classifyMessageIntent(text: string): Promise<MessageIntent> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "text";

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
    // A whole-chain outage returns the hardcoded fallback string, which is not a
    // classification: treat it as "text".
    if (result.provider === "hardcoded") return "text";
    return parseIntent(result.text) ?? "text";
  } catch (err) {
    logWarn("intent", `classify failed, defaulting to text: ${err instanceof Error ? err.message : String(err)}`);
    return "text";
  } finally {
    clearTimeout(timer);
  }
}
