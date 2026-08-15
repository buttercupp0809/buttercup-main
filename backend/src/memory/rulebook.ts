// Phase 30: user-set conversational rulebook, ported from the sibling
// Pellow project. getActiveRules() feeds an OWNER RULES prompt layer that
// overrides style defaults. Poppy is multi-character (Pellow keys by
// userId alone), so every read/write here is scoped by BOTH userId AND
// characterId; the in-process cache key is `${userId}:${characterId}`.

import { prisma } from "@buttercupp/database";
import { callLLM } from "../llm/provider";
import { wordOverlap } from "../llm/memory-extractor";
import { userRulebookEnabled } from "../config/flags";
import { incrementCounter } from "../metrics";
import { track } from "../analytics/tracker";
import { logWarn } from "../utils/log";

export const MAX_ACTIVE_RULES = 10;
const DEDUP_SIMILARITY = 0.7;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedRules {
  instructions: string[];
  fetchedAt: number;
}
const _cache = new Map<string, CachedRules>();

function cacheKey(userId: string, characterId: string): string {
  return `${userId}:${characterId}`;
}

function invalidateCache(userId: string, characterId: string) {
  _cache.delete(cacheKey(userId, characterId));
}

export async function getActiveRules(userId: string, characterId: string): Promise<string[]> {
  if (!userRulebookEnabled()) return [];
  const key = cacheKey(userId, characterId);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.instructions;
  }
  let rows: { instruction: string }[] = [];
  try {
    rows =
      (await prisma.userRule.findMany({
        where: { userId, characterId, status: "active" },
        orderBy: [{ timesReinforced: "desc" }, { updatedAt: "desc" }],
        take: MAX_ACTIVE_RULES,
        select: { instruction: true },
      })) ?? [];
  } catch {
    rows = [];
  }
  const instructions = rows.map((r) => r.instruction);
  _cache.set(key, { instructions, fetchedAt: Date.now() });
  return instructions;
}

const EXTRACT_SYSTEM_PROMPT = `You classify whether a user's message is a standing conversational rule they want the assistant to follow from now on. Examples of rules: "start your sentences with capital letters", "please stop calling me dude", "always be grammatically accurate", "never send voice notes at night". NON-rules: general love ("i always love talking to you"), one-off requests ("send me a poem"), questions, venting.
Output ONLY strict JSON: {"isRule": boolean, "instruction": string}. When isRule is true, "instruction" is a normalized single-sentence imperative under 200 characters, e.g. "Start sentences with capital letters." When false, return {"isRule": false, "instruction": ""}.`;

interface ExtractResult {
  isRule: boolean;
  instruction: string;
}

function parseExtract(raw: string): ExtractResult | null {
  try {
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof parsed.isRule !== "boolean") return null;
    const instruction = typeof parsed.instruction === "string" ? parsed.instruction.trim() : "";
    return { isRule: parsed.isRule, instruction };
  } catch {
    return null;
  }
}

export interface CaptureResult {
  status: "created" | "reinforced" | "skipped";
  instruction?: string;
}

export async function captureRule(
  userId: string,
  characterId: string,
  messageText: string,
  messageId?: string,
  preExtracted?: { isRule: boolean; instruction: string },
): Promise<CaptureResult> {
  if (!userRulebookEnabled()) return { status: "skipped" };
  let extracted: ExtractResult | null = null;
  // Reuse the classifier's instruction when present to skip a second LLM call.
  if (preExtracted && preExtracted.isRule && preExtracted.instruction.trim()) {
    extracted = { isRule: true, instruction: preExtracted.instruction.trim() };
  } else {
    try {
      const { text } = await callLLM({
        purpose: "extract",
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: messageText }],
        maxTokens: 200,
        temperature: 0,
        timeoutMs: 3000,
      });
      extracted = parseExtract(text);
    } catch (err) {
      logWarn("rulebook", "extract failed", { reason: err instanceof Error ? err.message : String(err) });
      return { status: "skipped" };
    }
  }
  if (!extracted || !extracted.isRule) return { status: "skipped" };
  const instruction = extracted.instruction;
  if (!instruction || instruction.length > 200) return { status: "skipped" };

  const active = await prisma.userRule.findMany({
    where: { userId, characterId, status: "active" },
    orderBy: [{ createdAt: "asc" }],
  });
  // Dedup metric: reuse the extractor's wordOverlap (Jaccard) rather than a
  // new trigram implementation, per the phase plan.
  const dupe = active.find(
    (r) => wordOverlap(r.instruction.toLowerCase(), instruction.toLowerCase()) > DEDUP_SIMILARITY,
  );
  if (dupe) {
    await prisma.userRule.update({
      where: { id: dupe.id },
      data: { timesReinforced: { increment: 1 }, updatedAt: new Date() },
    });
    invalidateCache(userId, characterId);
    incrementCounter("user_rule_reinforced");
    return { status: "reinforced", instruction: dupe.instruction };
  }
  if (active.length >= MAX_ACTIVE_RULES) {
    // Retire the oldest single-reinforce rule to make room.
    const retirable = active
      .filter((r) => r.timesReinforced === 1)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (retirable) {
      await prisma.userRule.update({
        where: { id: retirable.id },
        data: { status: "retired" },
      });
      incrementCounter("user_rule_retired");
    } else {
      // Every rule has been reinforced. Skip the new one rather than
      // overwriting a rule the user has re-set.
      return { status: "skipped" };
    }
  }
  await prisma.userRule.create({
    data: {
      userId,
      characterId,
      ruleText: messageText.slice(0, 500),
      instruction,
      sourceMessageId: messageId ?? null,
    },
  });
  invalidateCache(userId, characterId);
  incrementCounter("user_rule_created");
  track("user_rule_created", { characterId }, userId);
  return { status: "created", instruction };
}

// Test-only helper: clear the in-process cache.
export function _clearRulebookCache(): void {
  _cache.clear();
}
