# Phase 05: Long-term memory (RAG)

## Goal
Give Poppy the memory that is the product's central wedge (PRD §1.1). Build a pgvector-backed `Memory` store plus the full Pellow-style pipeline: an async post-turn extractor that pulls salient facts and summaries, a hybrid keyword-plus-semantic retriever returning top-K, an embeddings module, and summarization + tiering (hot/warm/cold) + compaction to keep context bounded. Wire retrieved memory and the latest summary into the layered system prompt built in Phase 04 (replacing the placeholder there). Memory is strictly isolated per `(user, character)`. Expose user-facing memory management endpoints (`GET /api/memory`, `DELETE /api/memory/:id`).

Covers PRD §5.4 (memory RAG) and §10 (memory pipeline + system-prompt injection).

## Prerequisites
- Phase 04 green: LLM provider chain, layered `buildPromptLayers()` with a **memory placeholder slot**, `Conversation` + `Message` persistence, WS/SSE streaming.
- Phase 02 schema includes `Memory` (ⓥ embedding), `MemorySummary` (ⓥ embedding), `RelationshipState`, all keyed by `userId` + `characterId`. pgvector extension enabled on the local DB.
- `packages/database` Prisma singleton; `backend/src/utils/retry.ts`, `safe-types.ts`, `audit.ts`, `config/flags.ts` present (Phase 00).

## Context to paste into Cursor
> Building Poppy Phase 05 (long-term memory / RAG). Read `prds/master-prd.md` §5.4 and §10 first. This mirrors Pellow's memory system almost verbatim, but every store, query, and prompt injection is scoped to `(userId, characterId)` instead of Pellow's single-companion `(userId)`. Prisma singleton `import { prisma } from "@poppy/database"`. pgvector queried with raw SQL using the cosine distance operator `<=>` and converted to similarity as `1 - distance`. TypeScript strict, Zod on the memory endpoints, no em dashes.
>
> Reference Pellow files to mirror (adapt the isolation key to add `characterId`):
> - Extractor: `../Pellow/backend/src/llm/memory-extractor.ts`: `extractMemories()`, `purpose: "extract"`, `DUPLICATE_THRESHOLD = 0.6`, VALID_TOPICS, hard/soft + importance + confidence + emotional valence.
> - Retriever: `../Pellow/backend/src/llm/memory-retriever.ts`: `getRelevantMemories()`, hybrid score weights (W_VECTOR 0.30, W_BM25 0.22, W_RECENCY 0.13, W_IMPORTANCE 0.13, W_CONFIDENCE 0.07, W_EMOTIONAL 0.15), pgvector `SELECT 1 - (embedding <=> $1::vector) as similarity ... ORDER BY embedding <=> $1::vector`, sacred/pinned always-include, MIN_SCORE thresholds.
> - Embeddings: `../Pellow/backend/src/llm/embeddings.ts`: `embed()` / `embedBatch()`, in-process `Xenova/all-MiniLM-L6-v2`, 384 dims (`EMBEDDING_DIM = 384`), int8 quantized, no API calls, `warmupEmbeddings()` at startup.
> - Compactor: `../Pellow/backend/src/memory/compactor.ts`: `runWeeklyCompaction()`, `purpose: "summary"`, JSON result (summary/themes/sentiment/keyEvents), archive stale memories, BATCH_SIZE=5.
> - Tiering: `../Pellow/backend/src/memory/tiering.ts`: `rebalanceTiers()`, three tiers, CORE_CAP=25, access-count + recency + importance precedence.
> - Hybrid retrieval reference (RRF + tsvector keyword + vector): `../Pellow/backend/src/knowledge/store.ts`.
>
> Naming note: Poppy's schema uses tier values `hot | warm | cold` (PRD §8). Map Pellow's core/recall/archive to hot/warm/cold respectively.

## Build steps
Do these in order. Name files exactly as below.

1. **Embeddings module**: `backend/src/llm/embeddings.ts`
   - Port Pellow's module: `embed(text): Promise<number[] | null>`, `embedBatch(texts): Promise<(number[]|null)[]>` (batch size 32), `cosineSimilarity(a,b)`, `warmupEmbeddings()`, export `EMBEDDING_DIM = 384`. Use `@huggingface/transformers`, model `Xenova/all-MiniLM-L6-v2`, `dtype: "q8"`, mean pooling + normalize, truncate input at 2000 chars. In-process, no external API. Call `warmupEmbeddings()` from backend startup (fire-and-forget).

2. **Memory store (raw SQL for vectors)**: `backend/src/memory/store.ts`
   - `writeMemory({ userId, characterId, content, category, importance, confidence, tier, salience, sourceMessageId, emotionalValence })`: compute `embed(content)`, insert via `prisma.$executeRaw` writing the `embedding` column as `$::vector`. Never `new PrismaClient()`.
   - `vectorSearchMemories(userId, characterId, queryEmbedding, limit)`: `prisma.$queryRaw` running `SELECT id, 1 - ("embedding" <=> $1::vector) AS similarity FROM "Memory" WHERE "userId"=$2 AND "characterId"=$3 AND "embedding" IS NOT NULL AND tier <> 'cold' ORDER BY "embedding" <=> $1::vector LIMIT $4`. The `characterId` predicate is the isolation boundary; it must be present in every read and write.

3. **Extractor (async, post-turn)**: `backend/src/llm/memory-extractor.ts`
   - `extractMemories({ userId, characterId, userName, characterName, userMessage, assistantMessage, sourceMessageId })`: mirror Pellow. Skip if message < MIN_MESSAGE_LENGTH (10). Call `callLLM({ purpose: "extract", temperature: 0, maxTokens: 500, systemPrompt: "...output only valid JSON..." })`. Parse JSON (fence-stripping fallback `parseExtractionJson`). For each candidate: dedupe against existing memories for this `(user,character)` using `wordOverlap >= DUPLICATE_THRESHOLD (0.6)`; validate `topic` against VALID_TOPICS; then `writeMemory(...)` with an initial tier of `hot` (map Pellow "core"/default → hot for fresh salient facts, else warm).
   - This runs off the response path: Phase 04 must call it after `chat.done` (fire-and-forget, wrapped so a failure never blocks the turn), passing `characterId`.

4. **Retriever (hybrid, top-K)**: `backend/src/llm/memory-retriever.ts`
   - `getRelevantMemories({ userId, characterId, currentMessage, maxResults, currentValence })`: mirror Pellow's hybrid ranker.
     - Candidate set: `vectorSearchMemories(...)` (top ~30 by cosine) UNION recent + always-include (sacred/pinned).
     - Score each candidate = `W_VECTOR*vector + W_BM25*bm25 + W_RECENCY*recency + W_IMPORTANCE*importance + W_CONFIDENCE*confidence + W_EMOTIONAL*resonance` (weights from Pellow). Include `bm25Score`, `recencyScore` (exp decay), `importanceScore`, `computeEmotionalResonance`.
     - Apply MIN_SCORE threshold, topic-match bonus (×1.15), prepend always-include, cap at `maxResults` (default 15).
     - Demote `cold`-tier memories out of the main set (only surfaced via explicit topic promotion, mirroring Pellow archive).
   - `getLatestSummary(userId, characterId)`: fetch the newest `MemorySummary` row for injection.

5. **Summarization + tiering + compaction**: `backend/src/memory/compactor.ts` and `backend/src/memory/tiering.ts`
   - `compactor.ts`: `runCompaction(userId, characterId)` summarizes recent memories/messages via `callLLM({ purpose: "summary", temperature: 0 })`, writes a `MemorySummary` (with its own `embed(summary)`), and archives stale contributing memories (demote to `cold`). Port `buildCompactionPrompt`, JSON result shape (summary/themes/sentiment/keyEvents). BATCH_SIZE=5 for multi-user runs.
   - `tiering.ts`: `rebalanceTiers(userId, characterId)` recomputes tier per memory. Map Pellow rules to Poppy's `hot|warm|cold`:
     - `hot` = sacred/pinned, or high importance on identity/relationship topics, or accessCount ≥ 5 within 30 days. Hard cap (CORE_CAP 25) on hot per `(user,character)`.
     - `warm` = default, retrieved when relevant.
     - `cold` = not accessed ≥ 90 days + low importance, or expired `validUntil`.
   - Precedence: sacred/pinned → cold rules → hot rules → warm default. Expose `getTierStats(userId, characterId)` for the settings/debug view.

6. **Prompt injection (replace Phase 04 placeholder)**: in `backend/src/llm/prompts.ts` (the `buildPromptLayers` from Phase 04)
   - Populate the memory layer: call `getRelevantMemories(...)` + `getLatestSummary(...)` before generation, format retrieved memories as a compact block (grouped by importance/topic like Pellow's 4-layer stack), and the latest summary as a "what I remember about you" summary layer. Insert both between the RelationshipState layer and the safety guardrails layer (order per PRD §10). Keep the injection deterministic given the same inputs (snapshot-testable).

7. **Memory management endpoints**: shared DTOs in `packages/shared/src/memory.ts`, routes:
   - `frontend/app/api/memory/route.ts` `GET`: authed; return the caller's memories, optional `characterId` query filter (Zod). Never leak another user's or another character's rows.
   - `frontend/app/api/memory/[id]/route.ts` `DELETE`: authed; `assertSafeId`; verify the memory's `userId` equals the caller before deleting; fire-and-forget `audit.ts` log. Returns 404 (not 403) if it is not the caller's memory.

8. **Wire the loop**: confirm Phase 04's turn handler now: (a) retrieves memory before generation, (b) after `chat.done`, fire-and-forget `extractMemories(...)`, and (c) periodically (or on a threshold) triggers `runCompaction` + `rebalanceTiers` for the `(user,character)` pair.

## Test instructions
- **Vitest (extractor):** `backend/src/llm/__tests__/memory-extractor.test.ts`: mock `callLLM` to return a known JSON extraction from a sample user/assistant exchange; assert the expected facts are written with correct topic/importance and that a near-duplicate (wordOverlap ≥ 0.6) is skipped.
- **Vitest (retriever):** `backend/src/llm/__tests__/memory-retriever.test.ts`: seed memories with known embeddings; assert `getRelevantMemories` returns the semantically closest top-K via the cosine path and that sacred/pinned are always included. Verify a `cold`-tier memory is excluded from the default set.
- **Vitest (tiering):** `backend/src/memory/__tests__/tiering.test.ts`: a stale, low-importance, unaccessed memory is demoted to `cold`; a frequently accessed one is promoted to `hot`; hot is capped at 25.
- **Integration (recall over distance):** `backend/src/memory/__tests__/recall.integration.test.ts`: against a local test DB with pgvector: state a fact in message 1, run 20 more turns of unrelated chat, then assert the fact is retrieved and appears in the injected prompt on a later related query.
- Run: `npm run test -w backend -- memory`.

## Sanity checklist
- [ ] Memory is isolated per `(user, character)`: a fact told to character A is never retrieved for character B (same user), verified by the `characterId` predicate in every store read/write.
- [ ] `GET /api/memory` returns only the caller's rows; `DELETE /api/memory/:id` refuses (404) memories the caller does not own.
- [ ] Retrieval latency is acceptable locally (embedding is in-process; a single retrieval is well under the chat first-token budget).
- [ ] The composed system prompt visibly contains injected memory + the latest summary when relevant memories exist (dump the prompt in a dev log or snapshot).
- [ ] Extraction runs off the response path and a forced extractor failure does not block or delay the streamed reply.
- [ ] Tiering keeps hot bounded (≤ CORE_CAP) and demotes stale memories to cold; cold rows do not appear in default retrieval.

## Done criteria
"Green" = extractor/retriever/tiering Vitest suites pass, the recall integration test proves a fact from message 1 is recalled 20+ messages later, per-character isolation holds, the injected prompt shows retrieved memory + latest summary, and the two memory endpoints enforce ownership. The Phase 04 memory placeholder is fully replaced by real retrieval.

## Guardrail note
Do not commit, push, deploy, or run a migration against any non-local database in this phase. If pgvector index tuning or a schema change is needed, produce the migration locally and STOP to ask for explicit human approval before it touches any shared or production DB. Every commit, push, deploy, or non-local DB migration requires a fresh, explicit, per-action human approval.
