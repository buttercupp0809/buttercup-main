// Post-turn memory extractor. Consumes the user+assistant messages that
// just streamed, calls an LLM with a JSON-only extraction prompt, then
// writes deduped, validated candidates into the Memory store. Runs
// fire-and-forget from the chat engine so it never blocks the response.

import { createHash } from "node:crypto";
import { prisma } from "@buttercupp/database";
import { callLLM } from "./provider";
import { writeMemory, vectorSearchMemories } from "../memory/store";
import { embed } from "./embeddings";
import { deadLetter } from "../memory/dead-letter";
import { logWarn } from "../utils/log";
import { memoryGraphEnabled } from "../config/flags";
import { incrementCounter } from "../metrics";

const MIN_MESSAGE_LENGTH = 10;
const DUPLICATE_THRESHOLD = 0.6; // Jaccard word-overlap
const MAX_CANDIDATES = 5;

// Locked topic vocabulary. Extractions with an unknown topic are dropped so
// the retriever's topic-match bonus stays meaningful.
export const VALID_TOPICS = new Set<string>([
  "identity",
  "preference",
  "goal",
  "fear",
  "history",
  "relationship",
  "routine",
  "emotion",
  "trivia",
]);

// Phase 30: optional per-candidate people array, mirroring Pellow's
// buildExtractionPrompt "people" field. Purely additive: a candidate with no
// people is handled exactly as before. Consumed only when memoryGraphEnabled().
export interface ExtractionPerson {
  name: string;
  relation?: string | null;
  sentiment?: number | null;
}

export interface ExtractionCandidate {
  content: string;
  topic: string;
  importance: number;
  confidence: number;
  emotionalValence?: number;
  hard?: boolean;
  people?: ExtractionPerson[];
}

export interface ExtractionInput {
  userId: string;
  characterId: string;
  userName: string;
  characterName: string;
  userMessage: string;
  assistantMessage: string;
  sourceMessageId?: string | null;
}

const SYSTEM_PROMPT = [
  "You are a memory extraction service for a companion product.",
  "Read the user's most recent message and the assistant's reply.",
  "Extract 0 to 5 durable facts about the USER that are worth remembering long-term.",
  "Skip pleasantries, filler, and anything the assistant might already know from the persona.",
  "Output ONLY raw JSON. No markdown fences, no explanation.",
  "Schema: { \"candidates\": [ { \"content\": string, \"topic\": one_of_VALID_TOPICS, \"importance\": 0..1, \"confidence\": 0..1, \"emotionalValence\": -1..1, \"hard\": boolean, \"people\": [ { \"name\": string, \"relation\": string_or_null, \"sentiment\": -1..1_or_null } ] } ] }",
  "\"people\" is optional: include an entry for each specific person the fact is about (real name if given, else a stable label like \"boss\" or \"sister\"). Set relation and sentiment when the message makes them clear, else null. Omit or use [] when no specific person is involved.",
].join(" ");

// Strip common JSON-in-markdown wrappers so a well-behaved model that hedges
// with a fence still parses.
export function parseExtractionJson(raw: string): { candidates: ExtractionCandidate[] } {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    const parsed = JSON.parse(body);
    if (parsed && Array.isArray(parsed.candidates)) return { candidates: parsed.candidates };
  } catch {
    // fall through
  }
  return { candidates: [] };
}

// Word overlap dedupe: cheap, effective, no embedding needed. Two memories
// are duplicates when |A ∩ B| / |A ∪ B| >= threshold on token sets.
export function wordOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().match(/\b[\w']+\b/g) ?? []);
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Phase 23: stable content hash used for source-message idempotency. Lower
// case + whitespace-collapsed so trivial casing/spacing does not defeat the
// dedup. Not a security hash; just a fast, deterministic dedup key.
function normalizeForHash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function contentHashOf(content: string): string {
  return createHash("sha256").update(normalizeForHash(content)).digest("hex");
}

const NEIGHBOR_SIMILARITY_THRESHOLD = 0.6;
const MAX_EXTENDS_EDGES = 3;
const NEIGHBOR_SEARCH_LIMIT = 6;

// Phase 30: memory graph write-time edges. Design lineage: Supermemory
// (typed-relation graph, entity nodes) and Mem0 (extract-then-consolidate
// memory layer with graph links). Called only when memoryGraphEnabled();
// callers wrap this in their own try/catch too, but each sub-block here also
// catches independently so a person-entity failure never blocks the
// extends-neighbor pass (and vice versa). Never rethrows.
async function writeGraphForMemory(
  userId: string,
  characterId: string,
  memoryId: string,
  content: string,
  people: ExtractionPerson[] | undefined,
): Promise<void> {
  // 1. Person entities + about_person edges.
  try {
    for (const p of Array.isArray(people) ? people : []) {
      if (!p || typeof p.name !== "string" || p.name.trim().length === 0) continue;
      const name = p.name.trim().slice(0, 100);
      const normalizedName = name.toLowerCase();
      const relation = typeof p.relation === "string" && p.relation.trim() ? p.relation.trim().slice(0, 60) : null;
      const sentiment =
        typeof p.sentiment === "number" && Number.isFinite(p.sentiment)
          ? Math.max(-1, Math.min(1, p.sentiment))
          : null;

      const entity = await prisma.memoryEntity.upsert({
        where: {
          userId_characterId_kind_normalizedName: {
            userId,
            characterId,
            kind: "person",
            normalizedName,
          },
        },
        create: {
          userId,
          characterId,
          kind: "person",
          name,
          normalizedName,
          relation,
          sentiment,
        },
        update: {
          ...(relation ? { relation } : {}),
          ...(sentiment !== null ? { sentiment } : {}),
        },
      });

      await prisma.memoryEdge
        .create({
          data: {
            userId,
            characterId,
            sourceId: memoryId,
            targetId: null,
            entityId: entity.id,
            relation: "about_person",
            weight: 1.0,
            createdBy: "extraction",
          },
        })
        .catch(() => undefined);
    }
  } catch (err) {
    logWarn("memory-graph", "person entity/about_person write failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    incrementCounter("memory_edge_write_failed");
  }

  // 2. Extends edges to nearest vector neighbors.
  try {
    const vec = await embed(content);
    if (vec) {
      const hits = await vectorSearchMemories(userId, characterId, vec, NEIGHBOR_SEARCH_LIMIT);
      const edges = hits
        .filter((h) => h.id !== memoryId && h.similarity > NEIGHBOR_SIMILARITY_THRESHOLD)
        .slice(0, MAX_EXTENDS_EDGES)
        .map((h) => ({
          userId,
          characterId,
          sourceId: memoryId,
          targetId: h.id,
          relation: "extends",
          weight: h.similarity,
          createdBy: "extraction",
        }));
      if (edges.length > 0) {
        await prisma.memoryEdge.createMany({ data: edges, skipDuplicates: true });
      }
    }
  } catch (err) {
    logWarn("memory-graph", "extends-neighbor edge write failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    incrementCounter("memory_edge_write_failed");
  }
}

const RETRY_DELAY_MS = 250;

// Retry-once helper around callLLM. Deliberately narrow: one retry with a
// short backoff. On the second failure we return null; the caller
// dead-letters and returns 0 (never throws into the reply path).
async function callExtractWithRetry(prompt: string): Promise<string | null> {
  const invoke = () =>
    callLLM({
      purpose: "extract",
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 500,
      temperature: 0,
    });
  try {
    const res = await invoke();
    return res.text;
  } catch (firstErr) {
    logWarn("memory", "extract callLLM failed, retrying once", {
      reason: firstErr instanceof Error ? firstErr.message : String(firstErr),
    });
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      const res = await invoke();
      return res.text;
    } catch {
      // Propagate via null; the caller dead-letters with structured context.
      throw firstErr;
    }
  }
}

export async function extractMemories(input: ExtractionInput): Promise<number> {
  if (input.userMessage.length < MIN_MESSAGE_LENGTH) return 0;

  const prompt =
    `User (${input.userName}): ${input.userMessage}\n\n` +
    `Assistant (${input.characterName}): ${input.assistantMessage}`;

  let raw: string;
  try {
    const text = await callExtractWithRetry(prompt);
    if (text === null) return 0;
    raw = text;
  } catch (err) {
    await deadLetter(
      "extract_llm",
      {
        userId: input.userId,
        characterId: input.characterId,
        sourceMessageId: input.sourceMessageId ?? null,
      },
      err,
    );
    return 0;
  }

  const parsed = parseExtractionJson(raw);
  if (parsed.candidates.length === 0) {
    // Empty is valid (model saw nothing worth remembering). Only dead-letter
    // when the raw text was non-trivial but no candidates fell out, so a
    // model that reliably breaks the schema surfaces.
    if (raw.trim().length > 20 && !/^\s*\{\s*"candidates"\s*:\s*\[\s*\]\s*\}\s*$/.test(raw.trim())) {
      await deadLetter(
        "extract_parse",
        {
          userId: input.userId,
          characterId: input.characterId,
          sourceMessageId: input.sourceMessageId ?? null,
          sample: raw.slice(0, 200),
        },
        new Error("extractor: unparseable candidates"),
      );
    }
    return 0;
  }
  const { candidates } = parsed;

  // Load existing memories once for the dedupe pass. In steady state a user
  // has O(50) memories per character; a full scan is fine and avoids a
  // per-candidate query fan-out. We also pull contentHash so the Phase 23
  // source-message dedup key is available in memory.
  const existing = await prisma.memory.findMany({
    where: { userId: input.userId, characterId: input.characterId },
    select: { content: true, contentHash: true, sourceMessageId: true },
    take: 500,
  });

  // Phase 23: source-message + content-hash guard. Under concurrent turns
  // (WS + SSE racing, retries, replays) two extractor invocations for the
  // same (userId, characterId, sourceMessageId, contentHash) must resolve
  // to exactly one Memory row. Cheap in-memory check; the (userId,
  // characterId, sourceMessageId) index backs the DB read.
  const seenKeys = new Set<string>();
  const keyOf = (hash: string) => `${input.sourceMessageId ?? ""}::${hash}`;
  if (input.sourceMessageId) {
    for (const e of existing) {
      if (e.contentHash && e.sourceMessageId === input.sourceMessageId) {
        seenKeys.add(keyOf(e.contentHash));
      }
    }
  }

  let written = 0;
  for (const cand of candidates.slice(0, MAX_CANDIDATES)) {
    if (typeof cand.content !== "string" || cand.content.trim().length === 0) continue;
    if (typeof cand.topic !== "string" || !VALID_TOPICS.has(cand.topic)) continue;
    if (typeof cand.importance !== "number" || typeof cand.confidence !== "number") continue;

    const trimmed = cand.content.trim();
    const hash = contentHashOf(trimmed);

    // Idempotency guard (source-message + content-hash). Same turn seen
    // twice = one row.
    if (input.sourceMessageId && seenKeys.has(keyOf(hash))) continue;

    // Existing Jaccard 0.6 near-dup guard (untouched, Phase 05 behavior).
    const isDup = existing.some((e) => wordOverlap(e.content, trimmed) >= DUPLICATE_THRESHOLD);
    if (isDup) continue;

    // Hard/salient facts start hot; softer facts start warm. Cold is only
    // ever set by the tiering pass, never at write time.
    const tier = cand.hard || cand.importance >= 0.75 ? "hot" : "warm";

    let memoryId: string;
    try {
      memoryId = await writeMemory({
        userId: input.userId,
        characterId: input.characterId,
        content: trimmed,
        category: cand.topic,
        importance: Math.max(0, Math.min(1, cand.importance)),
        confidence: Math.max(0, Math.min(1, cand.confidence)),
        emotionalValence:
          typeof cand.emotionalValence === "number" ? Math.max(-1, Math.min(1, cand.emotionalValence)) : 0,
        tier,
        salience: Math.max(0, Math.min(1, cand.importance)),
        sourceMessageId: input.sourceMessageId ?? null,
        contentHash: hash,
      });
    } catch (err) {
      // Per-candidate write failure dead-letters but does not abort the
      // batch; the other candidates for this turn still get a chance.
      await deadLetter(
        "extract_write",
        {
          userId: input.userId,
          characterId: input.characterId,
          sourceMessageId: input.sourceMessageId ?? null,
          category: cand.topic,
        },
        err,
      );
      continue;
    }
    existing.push({ content: trimmed, contentHash: hash, sourceMessageId: input.sourceMessageId ?? null });
    if (input.sourceMessageId) seenKeys.add(keyOf(hash));
    written += 1;

    // Phase 30: memory graph write-time edges. Never breaks extraction: any
    // failure here is caught, counted, and logged, and the extractor's
    // return value / dead-letter behavior above is already committed.
    if (memoryGraphEnabled()) {
      await writeGraphForMemory(input.userId, input.characterId, memoryId, trimmed, cand.people).catch(
        (err) => {
          logWarn("memory-graph", "graph write block failed", {
            reason: err instanceof Error ? err.message : String(err),
          });
          incrementCounter("memory_edge_write_failed");
        },
      );
    }
  }
  return written;
}
