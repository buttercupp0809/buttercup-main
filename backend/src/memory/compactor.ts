// Weekly-ish memory compaction. For a (user, character) pair:
//   1. Pull the most recent messages + non-cold memories
//   2. Ask the summary LLM for a compact JSON summary
//   3. Persist a MemorySummary row (with its own embedding for future recall)
//   4. Archive the contributing memories by demoting them to `cold`
//
// The full compactor runs off-band (cron/worker). runCompactionForUser is
// exported so a request-time trigger can also invoke it when a threshold is
// crossed (e.g. > 100 memories for a pair).

import { prisma } from "@poppy/database";
import { callLLM } from "../llm/provider";
import { embed } from "../llm/embeddings";
import { assertSafeId } from "../utils/safe-types";
import { deadLetter } from "./dead-letter";

const BATCH_SIZE = 5;
const RECENT_MEMORY_LIMIT = 40;
const RECENT_MESSAGE_LIMIT = 60;

interface CompactionResult {
  summary: string;
  themes: string[];
  sentiment: string;
  keyEvents: string[];
}

const SYSTEM_PROMPT = [
  "You compress a conversation history and its memory notes into a JSON summary.",
  "Focus on durable facts, recurring themes, emotional arc, and key events.",
  "Output ONLY raw JSON. No markdown fences. Schema:",
  '{"summary": string (2-4 sentences), "themes": string[], "sentiment": "positive"|"neutral"|"negative"|"mixed", "keyEvents": string[]}',
].join(" ");

function buildCompactionPrompt(
  characterName: string,
  memories: { content: string; category: string }[],
  messages: { role: string; content: string }[],
): string {
  const memBlock = memories
    .map((m, i) => `${i + 1}. [${m.category}] ${m.content}`)
    .join("\n");
  const msgBlock = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  return `Character: ${characterName}\n\nMemories:\n${memBlock}\n\nRecent conversation:\n${msgBlock}`;
}

function parseCompactionJson(raw: string): CompactionResult | null {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    const parsed = JSON.parse(body);
    if (
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.themes) &&
      typeof parsed.sentiment === "string"
    ) {
      return {
        summary: parsed.summary,
        themes: parsed.themes.filter((t: unknown): t is string => typeof t === "string"),
        sentiment: parsed.sentiment,
        keyEvents: Array.isArray(parsed.keyEvents)
          ? parsed.keyEvents.filter((e: unknown): e is string => typeof e === "string")
          : [],
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function runCompactionForUser(userId: string, characterId: string): Promise<boolean> {
  assertSafeId(userId, "userId");
  assertSafeId(characterId, "characterId");

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return false;

  const memories = await prisma.memory.findMany({
    where: { userId, characterId, tier: { not: "cold" } },
    orderBy: { createdAt: "desc" },
    take: RECENT_MEMORY_LIMIT,
  });
  if (memories.length === 0) return false;

  // Recent messages across all conversations for this pair. Cheap; keeps the
  // compactor character-scoped.
  const messages = await prisma.message.findMany({
    where: {
      role: { in: ["user", "assistant"] },
      conversation: { userId, characterId },
    },
    orderBy: { createdAt: "desc" },
    take: RECENT_MESSAGE_LIMIT,
  });

  const prompt = buildCompactionPrompt(
    character.name,
    memories.map((m) => ({ content: m.content, category: m.category })),
    messages.reverse().map((m) => ({ role: m.role, content: m.content })),
  );

  // LLM call stays OUTSIDE the transaction: it is slow and external.
  let raw: string;
  try {
    const res = await callLLM({
      purpose: "summary",
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 600,
      temperature: 0,
    });
    raw = res.text;
  } catch (err) {
    await deadLetter("compact_llm", { userId, characterId }, err);
    return false;
  }

  const parsed = parseCompactionJson(raw);
  if (!parsed) return false;

  const periodStart = messages[0]?.createdAt ?? memories[memories.length - 1].createdAt;
  const periodEnd = new Date();

  // Phase 23: idempotency. If a summary already exists that overlaps this
  // window for the same (user, character) pair, do not create a second one.
  // A double-invocation (cron + threshold-trigger racing) resolves to a
  // single summary + a single demotion pass.
  const overlap = await prisma.memorySummary.findFirst({
    where: {
      userId,
      characterId,
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
    select: { id: true },
  });
  if (overlap) return false;

  const vec = await embed(parsed.summary);
  const demotable = memories
    .filter((m) => !m.pinned && m.importance < 0.75)
    .map((m) => m.id);
  const vecLit = vec ? `[${vec.join(",")}]` : null;

  // Phase 23: summary + vector patch + demotion in ONE transaction so a
  // crash between them cannot leave a summary with un-demoted memories or
  // vice versa. Interactive-transaction form (callback) is used so we can
  // read the newly-created summary id inside the tx to bind the vector
  // update parameter.
  try {
    await prisma.$transaction(async (tx) => {
      const summary = await tx.memorySummary.create({
        data: {
          userId,
          characterId,
          periodStart,
          periodEnd,
          summary: parsed.summary,
          themes: parsed.themes,
          sentiment: parsed.sentiment,
          keyEvents: parsed.keyEvents.length > 0 ? parsed.keyEvents : undefined,
        },
      });
      if (vecLit) {
        await tx.$executeRaw`UPDATE "MemorySummary" SET "embedding" = ${vecLit}::vector WHERE "id" = ${summary.id}`;
      }
      if (demotable.length > 0) {
        await tx.memory.updateMany({
          where: { id: { in: demotable } },
          data: { tier: "cold" },
        });
      }
    });
  } catch (err) {
    await deadLetter("compact_persist", { userId, characterId }, err);
    return false;
  }
  return true;
}

// Batch entry point for a cron worker. Iterates BATCH_SIZE (user, character)
// pairs at a time so a large fleet does not hammer the LLM provider.
export async function runCompactionBatch(pairs: { userId: string; characterId: string }[]): Promise<number> {
  let ok = 0;
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const slice = pairs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      slice.map((p) => runCompactionForUser(p.userId, p.characterId).catch(() => false)),
    );
    ok += results.filter(Boolean).length;
  }
  return ok;
}
