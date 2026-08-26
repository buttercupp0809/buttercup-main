// Intent layer for i2v video. Turns a terse user request ("she is working")
// into a concrete MOTION/scene description a Wan 2.2 i2v model can actually act
// on. Wan follows detailed motion prompts far better than bare phrases, and the
// user's action intent was previously getting lost. Identity/appearance is NOT
// described here: that is fixed by the InstantID-locked first frame, and
// re-describing it fights the image.
//
// Non-fatal by contract: any LLM failure/timeout/misconfig falls back to a
// deterministic template so a video job never fails because of prompt
// expansion (same resilience pattern as restyleFirstFrame returning null).

import { callLLM } from "../../llm/provider";
import { logInfo, logWarn } from "../../utils/log";

const SYSTEM_PROMPT = `You rewrite a short user request into ONE concise motion description for an image-to-video model that ANIMATES an existing still photo of a character.

Hard rules:
- Describe ONLY motion, action, camera, and lighting. NEVER describe the character's face, hair, body, age, or clothing: those are fixed by the input image and re-describing them corrupts it.
- Lead with the PRIMARY action the user asked for, stated as concrete physical motion (e.g. "typing on a laptop, glancing at the screen").
- Add subtle secondary motion that fits (soft breathing, slight head movement, occasional blink, gentle hair sway).
- Keep the camera mostly still or a slow subtle push-in. Keep lighting even and constant (no flicker or exposure change).
- Output ONE line, at most 50 words, comma-separated clauses. No preamble, no quotes, no explanation.`;

// Safe, deterministic enrichment used when the LLM is unavailable or returns
// something unusable. Preserves the user's action and adds stabilizing motion.
function deterministicMotion(userRequest: string): string {
  const base = userRequest.trim() || "relaxed idle pose";
  return `${base}, subtle natural movement, slight head motion, soft breathing, occasional blink, steady camera, even consistent lighting`;
}

export interface ExpandOptions {
  timeoutMs?: number;
}

// Returns a motion/scene clause to lead the video positive prompt with. Always
// resolves (never throws); worst case returns the deterministic template.
export async function expandVideoMotionPrompt(
  userRequest: string,
  opts: ExpandOptions = {},
): Promise<string> {
  const req = userRequest.trim();
  if (!req) return deterministicMotion(req);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await callLLM({
      purpose: "extract", // routes to the cheaper instruct models, not chat
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: req }],
      maxTokens: 120,
      temperature: 0.4,
      signal: controller.signal,
    });
    const text = (res.text ?? "").replace(/\s+/g, " ").replace(/^["']+|["']+$/g, "").trim();
    // Reject the hardcoded chat fallback, empty output, or a runaway response
    // (the model ignored "one line" and rambled) - use the template instead.
    if (!text || res.provider === "hardcoded" || text.length > 400) {
      logWarn("prompt-expand", "unusable LLM expansion, using template", {
        provider: res.provider,
        len: text.length,
      });
      return deterministicMotion(req);
    }
    logInfo("prompt-expand", "expanded video motion prompt", { provider: res.provider });
    return text;
  } catch (err) {
    logWarn("prompt-expand", `expand failed: ${err instanceof Error ? err.message : String(err)}`);
    return deterministicMotion(req);
  } finally {
    clearTimeout(timeout);
  }
}
