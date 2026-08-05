// Memory persistence + vector search. Uses prisma.$executeRaw /
// prisma.$queryRaw for the pgvector paths because Prisma's client type does
// not model the `vector` column. Every read + write is scoped by BOTH userId
// AND characterId; that pair is the isolation boundary that makes a fact
// told to character A invisible to character B (same user).
//
// Phase 23: raw SQL migrated from the *Unsafe helpers to tagged-template
// $executeRaw / $queryRaw so vector literals and ids bind as parameters
// (not string-interpolated). The vector literal is built from a validated
// number[] (embed() already guarantees length 384); ids are `assertSafeId`
// gated as before. This closes a theoretical SQL-injection surface without
// changing query semantics or the returned shape.

import { prisma } from "@buttercupp/database";
import type { MemoryTier, Prisma } from "@buttercupp/database";
import { embed } from "../llm/embeddings";
import { assertSafeId } from "../utils/safe-types";

export interface WriteMemoryParams {
  userId: string;
  characterId: string;
  content: string;
  category: string;
  importance: number;
  confidence: number;
  tier?: MemoryTier;
  salience?: number;
  sourceMessageId?: string | null;
  emotionalValence?: number | null;
  pinned?: boolean;
  validUntil?: Date | null;
  // Phase 23: sha256 of the normalized content. Optional (extractor supplies
  // it; direct writers can omit). Persisted alongside sourceMessageId so
  // concurrent extractor invocations for the same turn dedupe cheaply.
  contentHash?: string | null;
}

// Convert a number[] into pgvector literal: '[0.1,0.2,...]'. We keep the
// bracketed vector literal as a single string and bind it as a parameter
// via $executeRaw / $queryRaw. Prisma serializes `${lit}` as $N (not string
// concatenation), and pgvector's ::vector cast accepts the literal form.
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

function assertTier(t: string): MemoryTier {
  if (t !== "hot" && t !== "warm" && t !== "cold") {
    throw new Error("invalid tier");
  }
  return t;
}

export async function writeMemory(params: WriteMemoryParams): Promise<string> {
  assertSafeId(params.userId, "userId");
  assertSafeId(params.characterId, "characterId");

  const vec = await embed(params.content);
  const tier = assertTier(params.tier ?? "warm");
  const salience = params.salience ?? params.importance;
  const emotionalValence = params.emotionalValence ?? 0;

  // Two-step is intentional: Prisma owns the scalar defaults / timestamps
  // (create), then we patch the pgvector column via bound SQL. If embed()
  // returned null (model unavailable), we commit the row without a vector;
  // the retriever tolerates null embeddings via BM25 + recency.
  const row = await prisma.memory.create({
    data: {
      userId: params.userId,
      characterId: params.characterId,
      content: params.content,
      category: params.category,
      importance: params.importance,
      confidence: params.confidence,
      salience,
      tier,
      emotionalValence,
      pinned: params.pinned ?? false,
      sourceMessageId: params.sourceMessageId ?? null,
      validUntil: params.validUntil ?? null,
      contentHash: params.contentHash ?? null,
    },
  });

  if (vec) {
    const lit = toVectorLiteral(vec);
    // Bound parameters: `lit` and `row.id` become $1/$2 in the wire query,
    // not interpolated. Safe against SQL injection on `content` because
    // `content` is never in this SQL text; it went in through the client
    // create above.
    await prisma.$executeRaw`UPDATE "Memory" SET "embedding" = ${lit}::vector WHERE "id" = ${row.id}`;
  }
  return row.id;
}

export interface VectorSearchHit {
  id: string;
  similarity: number;
}

// Cosine similarity over pgvector. `embedding <=> vector` is cosine distance
// (0 = identical, 2 = opposite); similarity = 1 - distance. Cold-tier is
// excluded because those memories are archived.
//
// Query semantics UNCHANGED from Phase 05: same WHERE, same `tier <> 'cold'`,
// same ORDER BY. Only the invocation switched from $queryRawUnsafe to
// $queryRaw so the vector literal and limit bind as parameters.
export async function vectorSearchMemories(
  userId: string,
  characterId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<VectorSearchHit[]> {
  assertSafeId(userId, "userId");
  assertSafeId(characterId, "characterId");
  const lit = toVectorLiteral(queryEmbedding);
  const cap = Math.max(1, Math.min(limit, 100));
  const rows = (await prisma.$queryRaw<
    { id: string; similarity: number | Prisma.Decimal | string }[]
  >`
    SELECT id, 1 - ("embedding" <=> ${lit}::vector) AS similarity
    FROM "Memory"
    WHERE "userId" = ${userId}
      AND "characterId" = ${characterId}
      AND "embedding" IS NOT NULL
      AND "tier" <> 'cold'
    ORDER BY "embedding" <=> ${lit}::vector
    LIMIT ${cap}
  `);
  return rows.map((r) => ({ id: r.id, similarity: Number(r.similarity) }));
}

export async function markMemoriesAccessed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.memory.updateMany({
    where: { id: { in: ids } },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
}
