// LLM crisis-classification pass. Runs ONLY when the fast pass returned
// level >= 1. The LLM is allowed to escalate but never to downgrade the
// fast pass, so we take max(fastLevel, llmLevel). A total LLM failure
// falls back to the fast-pass level (fail safe, never fail open).

import { callLLM } from "../llm/provider";
import { stripThinkingBlocks } from "../llm/sanitize";
import { withRetry, RETRY_PRESETS } from "../utils/retry";
import type { CrisisLevel } from "./crisis-detector";

const SYSTEM = [
  "You are a safety classifier. Read the user's message and rate self-harm/suicide risk on a strict scale.",
  "Reply with EXACTLY one token: none, low, serious, or imminent. No punctuation, no explanation.",
].join(" ");

function tokenToLevel(t: string): CrisisLevel {
  const clean = t.trim().toLowerCase();
  if (clean.startsWith("imminent")) return 3;
  if (clean.startsWith("serious")) return 2;
  if (clean.startsWith("low")) return 1;
  return 0;
}

export async function confirmCrisisWithLLM(
  text: string,
  fastLevel: CrisisLevel,
): Promise<CrisisLevel> {
  try {
    const res = await withRetry(
      () =>
        callLLM({
          purpose: "safety",
          systemPrompt: SYSTEM,
          messages: [{ role: "user", content: text.slice(0, 2000) }],
          maxTokens: 10,
          temperature: 0,
        }),
      RETRY_PRESETS.llm,
      "crisis-confirm",
    );
    const clean = stripThinkingBlocks(res.text);
    const llmLevel = tokenToLevel(clean);
    return Math.max(fastLevel, llmLevel) as CrisisLevel;
  } catch {
    return fastLevel;
  }
}
