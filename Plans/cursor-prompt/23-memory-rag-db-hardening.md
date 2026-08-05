# Phase 23 - Memory / RAG + DB hardening and verification

## Goal
Harden the existing memory/RAG pipeline **without changing retrieval quality or scoring**. Today the extractor is fire-and-forget with no error handling or retry, the compactor and tiering rebalance do multi-row writes outside a transaction, some vector writes use `$executeRawUnsafe`, and `Message.tokenCost` is never populated. This phase: wraps multi-write memory ops in `prisma.$transaction`; adds idempotency/dedup guards before inserts; replaces `$executeRawUnsafe` with parameterized `$queryRaw`/`$executeRaw` where feasible; adds retry-once + structured `logError("memory", ...)` + a visible dead-letter log to the extractor so failures surface without blocking replies; populates `Message.tokenCost`; and ensures each turn persists user+assistant messages atomically. Ships a `memory-rag-verify` script + tests proving turn-1 fact retrieval at turn 20, per-(user,character) isolation, weekly summary generation, no duplicate memories under concurrent turns, and embedding dim == 384.

Reference: PRD §2.8 (memory/RAG/DB hardening), §4 (guardrails: parameterized SQL, no client-trusted state, no regression).

## Prerequisites
- Phase 05 green: `backend/src/llm/{memory-extractor,memory-retriever,embeddings}.ts`, `backend/src/memory/{store,compactor,tiering}.ts`, `Memory` + `MemorySummary` pgvector models, `EMBEDDING_DIM = 384` (Xenova all-MiniLM-L6-v2).
- Phase 21 green: `runChatTurn` already wraps the user+assistant message writes in a transaction (this phase strengthens/verifies it) and may populate `tokenCost`.
- `backend/src/utils/log.ts` (`logError`, `logInfo`, `logWarn`), `backend/src/utils/safe-types.ts` (`assertSafeId`), `backend/src/test-utils/db.ts` (`dbReachable` -> `DB_UP`).

## Context to paste into Cursor
```
You are implementing Phase 23 of Poppy (see prds/experience-monetization-prd.md §2.8, §4).

HARDEN the memory/RAG pipeline. Do NOT change retrieval scoring, weights, or the
extraction prompt/thresholds. Retrieval quality must stay identical; this is reliability
+ correctness + verification only.

Targets:
- Wrap multi-write ops in prisma.$transaction: compaction (summary create + vector patch
  + demote updateMany), tiering rebalance (the per-tier updateMany batch), and any batch
  memory writes.
- Add idempotency/dedup guards BEFORE memory inserts (beyond the existing Jaccard 0.6):
  a source-message guard so the same (userId, characterId, sourceMessageId, content-hash)
  is not inserted twice under concurrent turns.
- Replace $executeRawUnsafe with parameterized $executeRaw/$queryRaw where the vector
  literal allows. The vector literal itself is built from a validated number[] (embed()
  already guarantees length 384); ids are already assertSafeId-gated. Keep it injection-safe.
- Extractor stays FIRE-AND-FORGET (never blocks a reply) but gains: retry-once on failure,
  logError("memory", err, {...}) structured logging, and a visible dead-letter log entry so
  a persistent failure is observable.
- Populate Message.tokenCost. Ensure each turn persists user + assistant messages atomically.

No em dashes. TypeScript strict. Guard DB-backed tests with describe.skipIf(!DB_UP).
```

## Build steps

1. **Extractor reliability: `backend/src/llm/memory-extractor.ts`**
   - Keep the public `extractMemories(input)` signature and the fire-and-forget call site in `engine.ts` unchanged (it must never block or throw into the reply path).
   - Wrap the LLM call in a **retry-once** helper: on the first failure, wait a short backoff and retry a single time; on the second failure `logError("memory", err, { stage: "extract_llm", userId, characterId, sourceMessageId })` and append a **dead-letter log** entry (see step 6) then return 0. Never rethrow.
   - Wrap the JSON parse + candidate loop so a parse failure also dead-letters rather than silently returning (keep returning 0, but log it).
   - Add an **idempotency guard** before writing candidates: compute a stable content hash (`sha256(normalize(content))`) and skip a candidate if a `Memory` row already exists for `(userId, characterId, sourceMessageId, contentHash)`. This is on top of the existing Jaccard 0.6 dedup and is what makes concurrent duplicate turns safe. (Add a `contentHash String?` column to `Memory`, additive/nullable, plus a partial unique or just a lookup; see step 5 for the schema note.)
   - Do NOT change `MIN_MESSAGE_LENGTH`, `DUPLICATE_THRESHOLD`, `MAX_CANDIDATES`, `VALID_TOPICS`, or the extraction prompt. Behavior/quality unchanged.

2. **Store writes parameterized + guarded: `backend/src/memory/store.ts`**
   - `writeMemory`: keep the two-step (client create for scalars, raw for the vector). Replace `prisma.$executeRawUnsafe(...)` with `prisma.$executeRaw` using a tagged template so the value binds as a parameter:
     ```ts
     await prisma.$executeRaw`UPDATE "Memory" SET "embedding" = ${lit}::vector WHERE "id" = ${row.id}`;
     ```
     (`lit` is the bracketed literal from a validated `number[]` of length 384; `row.id` is a generated uuid. This keeps the value bound rather than string-interpolated.)
   - Optionally fold the scalar `create` + vector patch into a single `prisma.$transaction([...])` so a memory never exists without its embedding when `embed()` succeeded. If `embed()` returns null (model unavailable), commit the row without a vector as today (retriever tolerates null embeddings via BM25/recency).
   - `vectorSearchMemories`: it already uses `$queryRawUnsafe` with bound `$1..$4` positional params for ids/limits and only the vector literal in text; convert to `$queryRaw` tagged template where feasible, keeping the exact SQL (same WHERE, same `tier <> 'cold'`, same ORDER BY). Do NOT change the query semantics or the returned shape. `assertSafeId` stays.
   - Accept a `contentHash` param on `writeMemory` (from step 1) and persist it.

3. **Compaction transactionality: `backend/src/memory/compactor.ts`**
   - Wrap the summary write path in `prisma.$transaction`: the `memorySummary.create`, the vector patch (now parameterized `$executeRaw`), and the `memory.updateMany({ tier: "cold" })` demotion must all commit together or not at all. Today they are three separate awaits; a crash between them leaves a summary with un-demoted memories or vice versa.
   - Keep the LLM summary call OUTSIDE the transaction (it is slow and external); only the DB writes go inside. Keep the existing JSON-parse-with-fallback (`if (!parsed) return false`) unchanged.
   - Idempotency: guard against generating two summaries for the same `(userId, characterId, periodStart..periodEnd)` window under a double-invocation (check for an overlapping `MemorySummary` before create, or key on a period bucket). Do not change the weekly cadence or thresholds.

4. **Tiering rebalance transactionality: `backend/src/memory/tiering.ts`**
   - Wrap the per-tier write-back (`for (const [tier, ids] ...) prisma.memory.updateMany`) in a single `prisma.$transaction([...])` so a rebalance is all-or-nothing (a partial rebalance can strand memories in an inconsistent hot/warm/cold split). Build the array of `updateMany` promises and pass them to `$transaction`.
   - Do NOT change `classifyTier`, `CORE_CAP`, or the sort/priority logic. Tier assignment quality is unchanged; only the write is now atomic.

5. **Prisma schema (additive): `packages/database/prisma/schema.prisma`**
   - `model Memory`: add `contentHash String?` (nullable, additive) and an index to make the idempotency lookup cheap:
     ```
     contentHash String?
     @@index([userId, characterId, sourceMessageId])
     ```
     Optionally `@@unique([userId, characterId, sourceMessageId, contentHash])` if you want the DB to enforce dedup (be careful: nullable columns in a unique constraint allow multiple nulls in Postgres, which is acceptable here since old rows have null hash).
   - Do NOT alter `Memory.embedding` / `MemorySummary.embedding` (pgvector) or any existing column. No schema-breaking change. Generate the migration `--create-only --name add_memory_content_hash`; apply locally only.

6. **Dead-letter log + structured errors: `backend/src/memory/dead-letter.ts`** (new, small)
   - `export async function deadLetter(stage: string, ctx: Record<string, unknown>, err: unknown): Promise<void>` that writes a visible record of a failed memory op. Minimal viable: `logError("memory", err, { deadLetter: true, stage, ...ctx })` plus an append to a `MemoryDeadLetter` table (additive model: `id, userId, characterId, sourceMessageId?, stage, error, createdAt`) OR a structured log line the observability stack can alert on. Prefer the table so failures are queryable; if you add the model, it is additive (step 5 migration).
   - The extractor and compactor call `deadLetter(...)` on their terminal failures. This is the "failures surface without blocking replies" requirement.

7. **Message integrity: `backend/src/chat/engine.ts`**
   - Confirm/strengthen the atomic persistence from Phase 21: the normal-turn user-message create + assistant-message create + `conversation.update(messageCount += 2, lastMessageAt)` run inside one `prisma.$transaction([...])`. The crisis-intervention early return path (user message + intervention assistant message) should likewise be atomic.
   - Populate `Message.tokenCost` on the assistant message: if `streamLLM`/`callLLM` returns token usage, store it; otherwise estimate from output length (a documented approximation) so the column is no longer always null. Keep this best-effort and never let it fail the turn.

8. **Verification script: `backend/src/scripts/memory-rag-verify.ts`** (new)
   - A runnable script (`npm run verify:memory` -> `tsx backend/src/scripts/memory-rag-verify.ts`) that, against a local DB, seeds a user+character, writes a distinctive fact at "turn 1", writes ~19 unrelated turns, then runs `getRelevantMemories` for a query related to the turn-1 fact and asserts it is retrieved in the top results. Also asserts per-(user,character) isolation (a second character does not see the fact) and prints a pass/fail summary. Exit non-zero on failure so CI can gate on it. This complements the tests; it is the human-runnable "prove it works" tool the PRD asks for.

## Test instructions
```
# Vitest / integration (backend, DB-guarded)
npm run test -w backend -- memory
npm run test -w backend -- store
npm run test -w backend -- compactor
npm run test -w backend -- tiering

# Runnable verification (local DB up)
npm run verify:memory
```
Vitest cases (all `describe.skipIf(!DB_UP)` except the pure ones):
- **turn-1 fact retrieved at turn 20** (`memory/__tests__/retrieval.test.ts`): seed a fact turn 1, add 19 turns of noise, assert `getRelevantMemories` surfaces the turn-1 fact. Scoring weights unchanged (assert on presence, not exact score).
- **per-(user,character) isolation**: a fact written for `(userA, char1)` is not returned for `(userA, char2)` nor `(userB, char1)`. Confirms the `store.ts` WHERE clause boundary.
- **weekly summary generation**: `runCompactionForUser` produces a `MemorySummary` and, on the transactional path, demotes the contributing low-importance memories to cold atomically (assert both committed).
- **no duplicate memories under concurrent turns**: call `extractMemories` (or `writeMemory`) concurrently for the same `(userId, characterId, sourceMessageId, content)` via `Promise.all`; assert exactly one `Memory` row exists (idempotency guard + hash).
- **embedding dim == 384** (pure, no DB): `embed("hello world")` returns a vector of length `EMBEDDING_DIM === 384` (or null when the model is unavailable; skip the length assert only when null).
- **parameterized SQL**: a content string containing SQL metacharacters (`'; DROP TABLE ...`) round-trips through `writeMemory` -> `vectorSearchMemories` intact and does not error (proves the raw paths bind values, not interpolate).
- **extractor never throws / dead-letters**: mock `callLLM` to throw twice; assert `extractMemories` resolves to 0 (no throw), retried once, and wrote a dead-letter entry.

## Sanity checklist
- [ ] Compaction (summary + vector + demote) and tiering rebalance each run inside a single `prisma.$transaction`; a crash mid-op leaves no inconsistent state.
- [ ] `$executeRawUnsafe` / `$queryRawUnsafe` replaced with parameterized `$executeRaw` / `$queryRaw` in `store.ts` and `compactor.ts` (vector value bound, not interpolated); ids stay `assertSafeId`-gated.
- [ ] Extractor is still fire-and-forget (never blocks or throws into the reply), now with retry-once + `logError("memory", ...)` + a visible dead-letter entry on terminal failure.
- [ ] Idempotency guard (contentHash / source-message) prevents duplicate memories under concurrent turns, on top of the existing Jaccard 0.6 dedup.
- [ ] `Message.tokenCost` is populated on assistant messages; each turn persists user + assistant messages atomically (normal + crisis paths).
- [ ] Retrieval scoring, weights, thresholds, extraction prompt, tier classification are UNCHANGED (quality identical).
- [ ] Migration is additive (`Memory.contentHash`, optional `MemoryDeadLetter`); no change to `Memory`/`MemorySummary` vector columns; applied locally only.
- [ ] `memory-rag-verify` script and tests prove: turn-1 fact at turn 20, isolation, weekly summary, no duplicates under concurrency, dim 384.

## Done criteria
- Multi-write memory ops are transactional and idempotent; raw SQL is parameterized; extractor fails safely and visibly without blocking replies; `tokenCost` populated; turns atomic.
- Verification script + tests green (or cleanly skipped when no DB) proving retrieval, isolation, summaries, no-duplicates, dim 384.
- Zero regression to retrieval quality, scoring, or the Memory/MemorySummary schema shape.

## Guardrail note
STOP before any commit, push, **non-local DB migration** (this phase adds `Memory.contentHash` and optionally a `MemoryDeadLetter` model, applying that migration to any hosted/prod database requires explicit, fresh, per-action human approval), secret writes, or ECS/Amplify deploy. Local work (edits, local Postgres migrate, local tests, `npm run verify:memory` against local DB, local dev server) proceeds without it. Prior approval never carries to the next action.
