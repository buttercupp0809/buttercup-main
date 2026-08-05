// Hybrid memory retrieval. Combines pgvector semantic search with a BM25-ish
// keyword lane, recency, importance, confidence, and emotional resonance.
// Weights mirror Pellow (PRD §10) so behaviour is directly comparable.
//
// Candidate flow:
//   1. vector top-N (via pgvector cosine over the query embedding)
//   2. UNION always-include: pinned + recent + sacred (importance >= 0.9)
//   3. score each candidate with the weighted sum
//   4. topic-match bonus (x1.15) when a candidate's category equals the
//      inferred topic of the current message
//   5. threshold + cap
//
// The rendered block is what buildPromptLayers injects into the system
// prompt (Phase 04's memory slot).

import { prisma } from "@poppy/database";
import type { Memory, MemorySummary } from "@poppy/database";
import { embed } from "./embeddings";
import { vectorSearchMemories, markMemoriesAccessed } from "../memory/store";
import { assertSafeId } from "../utils/safe-types";

// Weights (must sum to ~1.0). Kept in one const so tuning is trivial.
export const W_VECTOR = 0.30;
export const W_BM25 = 0.22;
export const W_RECENCY = 0.13;
export const W_IMPORTANCE = 0.13;
export const W_CONFIDENCE = 0.07;
export const W_EMOTIONAL = 0.15;

export const MIN_SCORE = 0.15;
export const DEFAULT_MAX_RESULTS = 15;
export const VECTOR_CANDIDATE_LIMIT = 30;
export const RECENCY_HALF_LIFE_DAYS = 30;
export const TOPIC_MATCH_BONUS = 1.15;

export interface RetrieveInput {
  userId: string;
  characterId: string;
  currentMessage: string;
  maxResults?: number;
  currentValence?: number; // -1..1
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  breakdown: {
    vector: number;
    bm25: number;
    recency: number;
    importance: number;
    confidence: number;
    emotional: number;
    topicBonus: boolean;
    pinned: boolean;
  };
}

// Cheap BM25-flavour keyword score: bag-of-words overlap weighted by inverse
// document frequency approximation. Not real BM25 (no doc frequencies), but
// enough signal on a per-user memory set.
export function bm25Score(query: string, doc: string): number {
  const tokenize = (s: string) => s.toLowerCase().match(/\b[\w']+\b/g) ?? [];
  const q = new Set(tokenize(query));
  const d = tokenize(doc);
  if (q.size === 0 || d.length === 0) return 0;
  let hits = 0;
  for (const t of d) if (q.has(t)) hits += 1;
  // Normalize to [0,1] using log length damping so long memories are not
  // unfairly boosted.
  return Math.min(1, hits / Math.max(1, Math.log2(d.length + 2)));
}

// Exponential decay in days. score = 0.5 ^ (ageDays / halfLife).
export function recencyScore(createdAt: Date, now = new Date()): number {
  const days = Math.max(0, (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

// Emotional resonance: memories closer in valence to the current message
// score higher. If we have no signal from the current message, treat this
// component as neutral (0.5).
export function computeEmotionalResonance(memValence: number, currentValence?: number): number {
  if (typeof currentValence !== "number") return 0.5;
  const diff = Math.abs(memValence - currentValence); // 0..2
  return Math.max(0, 1 - diff / 2);
}

// Naive topic inference from the current message: match against the topic
// vocabulary used by the extractor. If no topic word appears, return null
// (no topic bonus applied).
const TOPIC_WORDS: Record<string, RegExp> = {
  identity: /\b(name|born|from|live|age|old|birthday)\b/i,
  preference: /\b(like|love|hate|prefer|favou?rite)\b/i,
  goal: /\b(goal|dream|plan|hope|ambition|want to)\b/i,
  fear: /\b(afraid|fear|worry|anxious|scared)\b/i,
  history: /\b(when i was|used to|remember when|last (year|week|month))\b/i,
  relationship: /\b(friend|partner|mom|dad|brother|sister|family)\b/i,
  routine: /\b(every (day|morning|night)|usually|always)\b/i,
  emotion: /\b(feel|feeling|felt|happy|sad|angry|joy)\b/i,
};

function inferTopic(message: string): string | null {
  for (const [topic, re] of Object.entries(TOPIC_WORDS)) {
    if (re.test(message)) return topic;
  }
  return null;
}

export async function getRelevantMemories(input: RetrieveInput): Promise<ScoredMemory[]> {
  assertSafeId(input.userId, "userId");
  assertSafeId(input.characterId, "characterId");
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const inferredTopic = inferTopic(input.currentMessage);

  // 1. Semantic candidates.
  const queryVec = await embed(input.currentMessage);
  const vectorHits = queryVec
    ? await vectorSearchMemories(input.userId, input.characterId, queryVec, VECTOR_CANDIDATE_LIMIT)
    : [];
  const vectorSimById = new Map(vectorHits.map((h) => [h.id, h.similarity]));

  // 2. Always-include: pinned + top-recent, non-cold.
  const alwaysInclude = await prisma.memory.findMany({
    where: {
      userId: input.userId,
      characterId: input.characterId,
      tier: { not: "cold" },
      OR: [
        { pinned: true },
        { importance: { gte: 0.9 } },
      ],
    },
    take: 20,
  });

  // Hydrate the vector hits (retriever needs the full rows for scoring).
  const vectorRows = vectorHits.length > 0
    ? await prisma.memory.findMany({
        where: { id: { in: vectorHits.map((h) => h.id) } },
      })
    : [];

  const byId = new Map<string, Memory>();
  for (const r of vectorRows) byId.set(r.id, r);
  for (const r of alwaysInclude) byId.set(r.id, r);

  // 3. Score each candidate.
  const now = new Date();
  const scored: ScoredMemory[] = [];
  for (const memory of byId.values()) {
    if (memory.tier === "cold" && !memory.pinned) continue;
    const v = vectorSimById.get(memory.id) ?? 0;
    const b = bm25Score(input.currentMessage, memory.content);
    const r = recencyScore(memory.createdAt, now);
    const imp = memory.importance;
    const conf = memory.confidence;
    const emo = computeEmotionalResonance(memory.emotionalValence, input.currentValence);

    let score =
      W_VECTOR * v +
      W_BM25 * b +
      W_RECENCY * r +
      W_IMPORTANCE * imp +
      W_CONFIDENCE * conf +
      W_EMOTIONAL * emo;

    const topicBonus = inferredTopic !== null && memory.category === inferredTopic;
    if (topicBonus) score *= TOPIC_MATCH_BONUS;

    if (memory.pinned) score = Math.max(score, MIN_SCORE + 0.01);

    scored.push({
      memory,
      score,
      breakdown: {
        vector: v,
        bm25: b,
        recency: r,
        importance: imp,
        confidence: conf,
        emotional: emo,
        topicBonus,
        pinned: memory.pinned,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((s) => s.score >= MIN_SCORE || s.memory.pinned).slice(0, maxResults);

  // Fire-and-forget access tracking so we can promote frequently used
  // memories later.
  const ids = filtered.map((f) => f.memory.id);
  markMemoriesAccessed(ids).catch(() => {
    // swallowed
  });

  return filtered;
}

export async function getLatestSummary(
  userId: string,
  characterId: string,
): Promise<MemorySummary | null> {
  assertSafeId(userId, "userId");
  assertSafeId(characterId, "characterId");
  return prisma.memorySummary.findFirst({
    where: { userId, characterId },
    orderBy: { periodEnd: "desc" },
  });
}

// Compact block the prompt assembler injects. Deterministic given the same
// scored inputs. Grouped by topic so the model can scan quickly.
export function renderMemoryBlock(
  scored: ScoredMemory[],
  summary: MemorySummary | null,
): string {
  const lines: string[] = [];
  if (summary) {
    lines.push(`Recent summary (${summary.periodStart.toISOString().slice(0, 10)} - ${summary.periodEnd.toISOString().slice(0, 10)}):`);
    lines.push(summary.summary);
    if (summary.themes.length > 0) lines.push(`Themes: ${summary.themes.join(", ")}`);
    lines.push("");
  }
  if (scored.length > 0) {
    lines.push("Recalled facts about the user:");
    const byTopic = new Map<string, string[]>();
    for (const s of scored) {
      const key = s.memory.category || "other";
      const bucket = byTopic.get(key) ?? [];
      bucket.push(`- ${s.memory.content}`);
      byTopic.set(key, bucket);
    }
    for (const [topic, items] of byTopic) {
      lines.push(`(${topic})`);
      for (const it of items) lines.push(it);
    }
  }
  return lines.join("\n");
}
