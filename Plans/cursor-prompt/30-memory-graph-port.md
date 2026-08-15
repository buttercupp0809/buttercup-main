# Phase 30: Memory Graph Port (Entities + Edges)

## Goal
Port the richer graph / entity memory architecture from the sibling Pellow
project into ButterCupp on top of the base memory system Phases 05 and 23
already shipped. Poppy has flat `Memory` + `MemorySummary` rows with a hybrid
vector+BM25 retriever, a fire-and-forget extractor, a compactor, and tiering.
Pellow adds a **memory graph**: stable `MemoryEntity` rows (the people / places
that recur across a user's memories) and `MemoryEdge` rows (typed relations
`about_person | extends | derives` between memories, or between a memory and an
entity). It also ships four supporting modules (dreaming, pattern-detector,
persona-builder, rulebook) and a coverage helper for gap-free summary
injection.

This phase:
1. adds `MemoryEntity` and `MemoryEdge` Prisma models to poppy, mirroring
   Pellow but adapted to poppy conventions (isolation on `(userId,
   characterId)`, cascade on user delete, the Prisma singleton, 384-dim
   embeddings reused as-is), with an **additive LOCAL migration**;
2. ports `dreaming.ts`, `pattern-detector.ts`, `persona-builder.ts`,
   `rulebook.ts`, and `coverage.ts` into `backend/src/memory/`, adapting every
   import to poppy's utils (`log.ts`, `metrics.ts`, `config/flags.ts`,
   `safe-types.ts`) and to the `(userId, characterId)` key;
3. extends the extractor to populate entities + edges alongside the existing
   flat `Memory` rows, behind a `memoryGraphEnabled()` flag, never breaking
   extraction on a graph write failure;
4. extends the retriever with a graph-aware variant
   (`getRelevantMemoriesWithGraph`) that layers entity-linked recall and
   one-hop relationship traversal **on top of** the existing hybrid
   vector+BM25 scoring, and surfaces a small CONNECTIONS block;
5. keeps the extraction trigger wired into poppy's chat turn (it already fires
   fire-and-forget at `engine.ts:269`) and points the retrieval read at the
   graph-aware variant behind the flag;
6. records the design's conceptual lineage: **Supermemory** (typed edges,
   supersession, entity graph) and **Mem0** (extract-then-consolidate memory
   layer with graph relations).

Design note (Supermemory + Mem0 lineage): the entity/edge model mirrors
Supermemory's typed-relation graph and Mem0's two-stage "extract facts, then
link + consolidate them into a graph" pattern. Poppy already implements the
extract stage (Phase 05); this phase adds the link + consolidate stage
(write-time edges in the extractor, nightly clustering in `dreaming.ts`).

Preserve poppy's existing retrieval scoring, weights (`W_VECTOR 0.30`,
`W_BM25 0.22`, `W_RECENCY 0.13`, `W_IMPORTANCE 0.13`, `W_CONFIDENCE 0.07`,
`W_EMOTIONAL 0.15`), thresholds, and the extraction prompt UNCHANGED. The graph
is purely additive recall: the base `getRelevantMemories(...)` result is the
seed set, and the graph expansion appends neighbors under a hard cap. Local DB
only.

## Prerequisites
- **Phase 05 green**: `backend/src/llm/{memory-extractor,memory-retriever,embeddings}.ts`,
  `backend/src/memory/{store,compactor,tiering}.ts`, `Memory` + `MemorySummary`
  pgvector models, `EMBEDDING_DIM = 384` (Xenova all-MiniLM-L6-v2, `dtype q8`).
- **Phase 23 green**: extractor is fire-and-forget with retry-once +
  `deadLetter(...)`; `store.ts` uses parameterized `$executeRaw`/`$queryRaw`;
  `Memory.contentHash` + `MemoryDeadLetter` exist; tiering rebalance and
  compaction run inside `prisma.$transaction`.
- Chat turn: `backend/src/chat/engine.ts` `runChatTurn` already retrieves memory
  before generation (`getRelevantMemories` + `getLatestSummary` at ~line 159)
  and fires `extractMemories(...)` fire-and-forget after the atomic
  user+assistant write (`void extractMemories({...}).catch(...)` at ~line 269,
  passing `sourceMessageId: assistantMessage.id`). This phase does NOT introduce
  the trigger (it exists); it keeps it and routes its writes through the graph.
- Utils present: `backend/src/utils/log.ts`
  (`logInfo`, `logWarn`, `logError(scope, err, extra)`),
  `backend/src/utils/safe-types.ts` (`assertSafeId`),
  `backend/src/metrics.ts` (`incrementCounter(name, by?)`),
  `backend/src/config/flags.ts` (`defaultOn` pattern),
  `backend/src/analytics/tracker.ts`,
  `backend/src/test-utils/db.ts` (`dbReachable` -> `DB_UP`).
- Prisma singleton `import { prisma } from "@buttercupp/database"`; never
  `new PrismaClient()`.

## Source map
Each Pellow source maps to a poppy target. Pellow is single-companion (keyed by
`userId` only); poppy is multi-character, so **every ported read/write gains a
`characterId` predicate** and entities/edges carry `characterId`. Pellow's
`type`/`topic`/`isLatest`/`isArchived`/`predicateKey`/`source` columns do not
exist on poppy's `Memory` (poppy uses `category`, `tier hot|warm|cold`,
`pinned`, no supersession); adapt field names accordingly.

| Pellow source | Poppy target | Adaptation notes |
|---|---|---|
| `packages/database/prisma/schema.prisma` `model MemoryEntity` (~146-163) | `packages/database/prisma/schema.prisma` `model MemoryEntity` | Add `characterId String`. Isolation unique becomes `@@unique([userId, characterId, kind, normalizedName])`; index `@@index([userId, characterId, kind])`. Keep `kind`, `name`, `normalizedName`, `relation`, `sentiment`, `aliases String[]`. Cascade `onDelete: Cascade` on `user`. |
| `model MemoryEdge` (~165-190) | `model MemoryEdge` | Add `characterId String`. Keep `sourceId`, `targetId?`, `entityId?`, `relation`, `weight`, `label?`, `createdBy`. `@@unique([sourceId, targetId, relation])`; indexes `@@index([userId, characterId, sourceId])`, `@@index([userId, characterId, targetId])`, `@@index([entityId])`. `entity` relation cascades; `user` cascades. |
| `User.memoryEntities` / `User.memoryEdges` (~118-119) | `model User` back-relations | Add `memoryEntities MemoryEntity[]` and `memoryEdges MemoryEdge[]` to poppy's `User`. |
| `backend/src/memory/dreaming.ts` | `backend/src/memory/dreaming.ts` | Cluster + derive edges/insights/supersession. Key loads by `(userId, characterId)`. Poppy has no `isLatest`/`isArchived`/supersededById, so DROP contradiction-supersession OR add it as a separate additive column set (see Build step 5 note); default: keep clustering + `derives` edges + `dreaming`-sourced insight memories, skip supersession. `@karoli/database` -> `@buttercupp/database`; `../metrics` incrementCounter kept; `console.*` -> `logInfo`/`logWarn` from `utils/log`. Insight memory uses `category` (not `type`/`topic`). Embedding write reuses `store.ts` `writeMemory` (do NOT re-implement the raw vector patch). |
| `backend/src/memory/pattern-detector.ts` | `backend/src/memory/pattern-detector.ts` | `detectEmotionalPatterns(userId, characterId)`. Poppy has no `EmotionalPattern` model or `Message.sender/sentAt` naming; adapt to poppy's `Message` (via `Conversation` -> `characterId`, `role`, `createdAt`) and add an additive `EmotionalPattern` model OR store patterns as `Memory` rows with `category:"emotion"`, `pinned:false` (simpler; recommended). `track(...)` -> `analytics/tracker`. `console.*` -> `utils/log`. Gate behind a `memoryGraphEnabled()`-adjacent flag. |
| `backend/src/memory/persona-builder.ts` | `backend/src/memory/persona-builder.ts` | `buildUserPersona(userId, characterId)`. Poppy has no `UserPersona`, `Personality`, `archetypeAnswers`, emotion state-engine, or onboarding fields; SIMPLIFY to: read top memories + latest summary + patterns for `(user,character)`, LLM-summarize into a persona paragraph, store as an additive `UserPersona` model keyed `@@unique([userId, characterId])` (or as a special pinned `Memory` with `category:"identity"`). Drop `inferAttachmentStyle`/`getEmotionalState` enrichment. `withRetry`/`RETRY_PRESETS` -> poppy `utils/retry`. |
| `backend/src/memory/rulebook.ts` | `backend/src/memory/rulebook.ts` | `getActiveRules(userId, characterId)` + `captureRule(...)`. Add additive `UserRule` model keyed by `(userId, characterId)` mirroring Pellow's (`ruleText`, `instruction`, `sourceMessageId?`, `status`, `timesReinforced`). `trigramSimilarity` -> port or reuse `wordOverlap` from the extractor as the dedup metric. `userRulebookEnabled()` flag added to poppy `flags.ts`. In-process cache keyed by `${userId}:${characterId}`. |
| `backend/src/memory/coverage.ts` | `backend/src/memory/coverage.ts` | `getTieredSummaries(userId, characterId)` + `formatTieredSummaries`. Poppy `MemorySummary` has no `period` column (only `periodStart`/`periodEnd`); SIMPLIFY to fetch the newest N summaries by `periodEnd` for `(user,character)` under a char budget. Pure fetch, no LLM. Timezone formatting kept. `memoryTieredContextEnabled()` flag added. |
| `backend/src/llm/memory-extractor.ts` graph block (~461-570) | `backend/src/llm/memory-extractor.ts` (extend existing) | Add a `people` field to the extraction schema, and after each `writeMemory(...)` that returns a memory id: upsert `MemoryEntity` per person and create an `about_person` edge, then create up to 3 `extends` edges to nearest vector neighbors. Scoped by `(userId, characterId)`. Behind `memoryGraphEnabled()`. Neighbor lookup reuses `vectorSearchMemories` from `store.ts` (returns ids); no new raw SQL. Never throws into the reply path (wrap in try/catch + `incrementCounter("memory_edge_write_failed")`). |
| `backend/src/llm/memory-retriever.ts` `getRelevantMemoriesWithGraph` (~514-602) | `backend/src/llm/memory-retriever.ts` (add function) | New export wraps `getRelevantMemories(input)` UNCHANGED, then when `memoryGraphEnabled()`: query `MemoryEdge` touching selected ids (scoped by `(userId,characterId)`), add up to `GRAPH_MAX_NEIGHBORS=5` unselected neighbors (hard cap `GRAPH_TOTAL_CAP=20`), and return `connections` (edges BETWEEN selected/added memories, cap `GRAPH_CONNECTIONS_MAX=6`). Neighbor rows filtered by `tier != cold`. Returns `{ scored, connections }`. |
| Pellow chat wiring `backend/src/messaging/handler.ts` (`extractMemories(...)` fire-and-forget ~497/1038; `getRelevantMemoriesWithGraph` ~1202; `buildUserPersona` ~1057; `captureRule` ~1816) | `backend/src/chat/engine.ts` (`runChatTurn`) | Poppy's engine already fires `extractMemories` (line ~269) and retrieves memory (line ~159). Route the retrieval read through `getRelevantMemoriesWithGraph` behind the flag, render the CONNECTIONS block into `injectedMemory`, and OPTIONALLY fire `buildUserPersona`/`captureRule` fire-and-forget after the turn (all wrapped, never blocking). |

## Context to paste into Cursor
```
You are implementing Phase 30 of ButterCupp: PORT Pellow's graph / entity memory
onto poppy's existing base memory (Phases 05 + 23). Read prds/master-prd.md
§5.4 and §10, plus Plans/cursor-prompt/05-memory-rag.md and
Plans/cursor-prompt/23-memory-rag-db-hardening.md first.

Conceptual lineage to preserve in comments: this graph design descends from
Supermemory (typed relation graph, entity nodes) and Mem0 (extract-then-
consolidate memory layer with graph links). Cite both in a header comment on
the new schema models and on getRelevantMemoriesWithGraph.

HARD RULES:
- Prisma singleton only: import { prisma } from "@buttercupp/database". Never
  new PrismaClient().
- Embeddings stay 384-dim (Xenova all-MiniLM-L6-v2). Do NOT change EMBEDDING_DIM.
- Do NOT change the extraction prompt thresholds, VALID_TOPICS, or the
  retriever weights / MIN_SCORE / DEFAULT_MAX_RESULTS. The graph is additive
  recall ONLY: base getRelevantMemories is the seed set; graph appends
  neighbors under GRAPH_TOTAL_CAP.
- Every graph read and write is scoped by BOTH userId AND characterId. That
  pair is the isolation boundary (a fact/entity for character A must never
  surface for character B, same user). Pellow keys by userId alone; you MUST
  add characterId everywhere.
- All new work is behind memoryGraphEnabled() (+ userRulebookEnabled,
  memoryDreamingEnabled, memoryTieredContextEnabled) so the flag-off path is
  byte-identical to today. Graph write failures NEVER break extraction and
  NEVER block a reply.
- No em dashes. TypeScript strict, no unexplained any. Zod on any new mutation
  boundary. Guard DB-backed tests with describe.skipIf(!DB_UP).

Pellow reference files to mirror (adapt userId -> (userId, characterId), and
Pellow Memory fields type/topic/isLatest/isArchived/predicateKey -> poppy
category/tier; poppy Memory has NO supersession columns):
- ../Pellow/packages/database/prisma/schema.prisma: model MemoryEntity (~146-163),
  model MemoryEdge (~165-190), User.memoryEntities/memoryEdges (~118-119).
- ../Pellow/backend/src/llm/memory-extractor.ts: graph write block (~461-570)
  (person entity upsert + about_person edge, then extends edges to top vector
  neighbors), the "people" field in buildExtractionPrompt (~88, ~108).
- ../Pellow/backend/src/llm/memory-retriever.ts: getRelevantMemoriesWithGraph
  (~491-602), constants GRAPH_MAX_NEIGHBORS/GRAPH_TOTAL_CAP/GRAPH_CONNECTIONS_MAX.
- ../Pellow/backend/src/memory/dreaming.ts (cluster + derive edges/insights),
  pattern-detector.ts, persona-builder.ts, rulebook.ts, coverage.ts.
- ../Pellow/backend/src/messaging/handler.ts for how extraction, graph
  retrieval, persona, and rulebook are wired into a turn (fire-and-forget).

Poppy targets: backend/src/memory/{dreaming,pattern-detector,persona-builder,
rulebook,coverage}.ts (new), backend/src/llm/memory-extractor.ts +
memory-retriever.ts (extend), backend/src/chat/engine.ts (retrieval read +
optional fire-and-forget), packages/database/prisma/schema.prisma (+ additive
LOCAL migration), backend/src/config/flags.ts (+ flags).
```

## Build steps
Do these in order. Name files exactly as below. Everything is local-only.

1. **Schema: `packages/database/prisma/schema.prisma` (additive).**
   - Add `model MemoryEntity` mirroring Pellow but with `characterId String`:
     fields `id`, `userId`, `characterId`, `kind String @default("person")`,
     `name`, `normalizedName`, `relation String?`, `sentiment Float?`,
     `aliases String[] @default([])`, `createdAt`, `updatedAt @updatedAt`;
     relations `user` (`onDelete: Cascade`) and `edges MemoryEdge[]`;
     `@@unique([userId, characterId, kind, normalizedName])`,
     `@@index([userId, characterId, kind])`.
   - Add `model MemoryEdge`: `id`, `userId`, `characterId`, `sourceId`,
     `targetId String?`, `entityId String?`, `relation String`,
     `weight Float @default(0.5)`, `label String?`,
     `createdBy String @default("extraction")`, `createdAt`; relations `user`
     (`onDelete: Cascade`) and `entity MemoryEntity?`
     (`fields: [entityId]`, `onDelete: Cascade`);
     `@@unique([sourceId, targetId, relation])`,
     `@@index([userId, characterId, sourceId])`,
     `@@index([userId, characterId, targetId])`, `@@index([entityId])`.
   - Add back-relations on `model User`: `memoryEntities MemoryEntity[]` and
     `memoryEdges MemoryEdge[]`.
   - Header comment on both models: cite Supermemory + Mem0 lineage; note
     `sourceId`/`targetId` reference `Memory.id` but are NOT declared FKs
     (Pellow keeps them loose so a superseded/archived memory does not cascade
     an edge delete; poppy mirrors this and prunes dangling edges in a later
     sweep). Nullable columns in the unique constraint allow multiple NULL
     `targetId` per source/relation (Postgres semantics), matching Pellow.
   - Generate the migration **local, create-only**:
     `prisma migrate dev --create-only --name add_memory_graph` then apply
     locally only. Additive: no change to `Memory`/`MemorySummary` vector
     columns or any existing column. Run `npm run check:no-em-dash`.
   - If porting the supporting modules with their own tables (patterns, persona,
     rules), add those additive models here too (`EmotionalPattern`,
     `UserPersona`, `UserRule`, each keyed by `(userId, characterId)` with a
     unique where Pellow had one) OR follow the "store as Memory rows"
     simplification in steps 6-9. Pick ONE approach per module and keep it
     consistent; the tables are additive and local-only.

2. **Flags: `backend/src/config/flags.ts`.**
   - Add, using the existing `defaultOn` pattern:
     `memoryGraphEnabled()`, `memoryDreamingEnabled()`, `userRulebookEnabled()`,
     `memoryTieredContextEnabled()`. Mirror Pellow's flag names so env parity
     holds. Default these OFF (return `process.env.X === "true"`) so the
     flag-off path is byte-identical to today, EXCEPT keep `memoryGraphEnabled`
     easy to turn on for tests.

3. **Extractor entity + edge writes: `backend/src/llm/memory-extractor.ts` (extend).**
   - Extend the extraction schema/prompt with an optional `people` array per
     candidate: `[{ name, relation, sentiment }]` (mirror Pellow's prompt
     lines ~88 and ~108). Keep `MIN_MESSAGE_LENGTH`, `DUPLICATE_THRESHOLD`,
     `MAX_CANDIDATES`, `VALID_TOPICS`, `SYSTEM_PROMPT` schema otherwise intact.
   - Change `writeMemory(...)` usage so the returned memory id is captured
     (`store.ts` already returns `row.id`). After a successful write, and only
     when `memoryGraphEnabled()`:
     - For each valid person: `prisma.memoryEntity.upsert` on
       `userId_characterId_kind_normalizedName` (create with `name`,
       `normalizedName = name.toLowerCase()`, `relation`, `sentiment` clamped
       to [-1,1]; update relation/sentiment when present), then
       `prisma.memoryEdge.create` with `relation:"about_person"`, `weight:1.0`,
       `entityId: entity.id`, `sourceId: memoryId`, `targetId: null`,
       scoped `userId`+`characterId`. `.catch(() => undefined)` per edge.
     - `extends` edges: call `vectorSearchMemories(userId, characterId, vec, 6)`
       (reuse the embedding you already computed for this memory if available;
       else `embed(content)`), filter `similarity > 0.6`, exclude the just-
       written id, take top 3, and `prisma.memoryEdge.createMany({ data, skipDuplicates: true })`
       with `relation:"extends"`, `weight: similarity`, `createdBy:"extraction"`.
   - Wrap the entire graph block in try/catch; on failure
     `logWarn("memory-graph", ...)` + `incrementCounter("memory_edge_write_failed")`
     and continue. Extraction return value (`written`) and its dead-letter
     behavior stay UNCHANGED. Never rethrow.

4. **Graph-aware retrieval: `backend/src/llm/memory-retriever.ts` (add function).**
   - Add constants `GRAPH_MAX_NEIGHBORS = 5`, `GRAPH_TOTAL_CAP = 20`,
     `GRAPH_CONNECTIONS_MAX = 6`, and `GRAPH_NEIGHBOR_MIN_WEIGHT` if needed.
   - Add `export interface MemoryConnection { fromId; toId; relation; label }`.
   - Add `export async function getRelevantMemoriesWithGraph(input: RetrieveInput):
     Promise<{ scored: ScoredMemory[]; connections: MemoryConnection[] }>`:
     - `const scored = await getRelevantMemories(input);` (UNCHANGED base).
     - If `!memoryGraphEnabled() || scored.length === 0` return
       `{ scored, connections: [] }`.
     - Query `prisma.memoryEdge.findMany` where `userId`+`characterId` and
       (`sourceId in selectedIds` OR `targetId in selectedIds`),
       `orderBy: { weight: "desc" }`.
     - Collect up to `GRAPH_MAX_NEIGHBORS` neighbor ids not already selected,
       hydrate via `prisma.memory.findMany` (scoped `userId`+`characterId`,
       `tier != "cold"`), preserving weight order; cap total at
       `GRAPH_TOTAL_CAP`. Append neighbors as `ScoredMemory` with a small
       synthetic score (do NOT re-run the full scorer; mark `breakdown` with a
       `graphNeighbor: true` flag) so `renderMemoryBlock` still renders them.
     - Build `connections` = edges where BOTH endpoints are in the final set,
       capped at `GRAPH_CONNECTIONS_MAX`.
     - Wrap in try/catch; on failure `logWarn("memory-graph", ...)` and return
       `{ scored, connections: [] }`. One indexed query budget.
   - Extend `renderMemoryBlock` (or add `renderMemoryBlockWithConnections`) to
     append a compact `Connections:` block listing `relation` between the two
     memory contents when `connections.length > 0`. Deterministic output.

5. **Port `backend/src/memory/dreaming.ts`.**
   - Port `clusterMemories` (deterministic greedy, `CLUSTER_THRESHOLD 0.55`,
     min 2 / max 8), `processCluster`, `runDreamingForUser(userId, characterId,
     opts?)`, `runDreamingForAllPairs()`. Load memories via a scoped raw
     `$queryRaw` (`WHERE "userId" = ${userId} AND "characterId" = ${characterId}`,
     recent window, `embedding::text`), reusing `cosineSimilarity` from
     `embeddings.ts`.
   - Derived edges: `prisma.memoryEdge.create` with `relation:"derives"`,
     `createdBy:"dreaming"`, scoped `userId`+`characterId`. Insight memories:
     `writeMemory({ ..., category: insight.topic-or-"trivia", tier:"warm",
     importance, confidence: 0.6 })` (reuse `store.ts`; do NOT hand-write the
     vector patch), then `derives` edges insight -> each member.
   - Supersession: poppy `Memory` has no `isLatest`/`supersededById`, so SKIP
     the contradiction-supersession branch (leave a TODO comment) UNLESS you
     added those columns in step 1; if not added, `processCluster` returns
     `supersessions: 0`. Behind `memoryDreamingEnabled()`. `console.*` ->
     `logInfo`/`logWarn`; counters kept.

6. **Port `backend/src/memory/pattern-detector.ts`.**
   - `detectEmotionalPatterns(userId, characterId)`: fetch recent `Message`
     rows for the pair (join through `Conversation.characterId`, use `role` and
     `createdAt`, not Pellow's `sender`/`sentAt`), build the pattern prompt,
     `callLLM({ purpose: "pattern" or "extract" })`, parse, and persist. Persist
     either to an additive `EmotionalPattern` model keyed
     `@@unique([userId, characterId, pattern])` OR (simpler, recommended) as
     `Memory` rows `category:"emotion"` with a dedup on `wordOverlap >= 0.6`.
     `track(...)` -> `analytics/tracker`. `console.*` -> `utils/log`. Gate the
     periodic trigger the same way Pellow does (every N user messages).

7. **Port `backend/src/memory/persona-builder.ts` (simplified).**
   - `buildUserPersona(userId, characterId)`: read top memories
     (`orderBy [{importance:"desc"},{createdAt:"desc"}]`, scoped), the latest
     `MemorySummary`, and patterns from step 6, build a persona prompt,
     `callLLM({ purpose:"summary" })` wrapped in poppy's `withRetry`
     (`utils/retry`), and store the persona paragraph in an additive
     `UserPersona` model (`@@unique([userId, characterId])`) OR as a pinned
     `Memory` `category:"identity"`. DROP the Pellow emotion-state /
     attachment-style enrichment (those subsystems do not exist in poppy).
     On LLM/parse failure keep the last-known-good persona (skip the upsert).
     `shouldBootstrapPersona(userId, characterId)` on a message-count threshold.

8. **Port `backend/src/memory/rulebook.ts`.**
   - Add additive `UserRule` model in step 1 keyed by `(userId, characterId)`.
   - `getActiveRules(userId, characterId)` (in-process cache keyed
     `${userId}:${characterId}`, TTL 5 min, `MAX_ACTIVE_RULES 10`) and
     `captureRule(userId, characterId, messageText, messageId?, preExtracted?)`.
     Dedup via a trigram/`wordOverlap` similarity > 0.7; reinforce or retire the
     oldest single-hit rule on overflow. Behind `userRulebookEnabled()`.
     `_clearRulebookCache()` test helper.

9. **Port `backend/src/memory/coverage.ts` (simplified).**
   - `getTieredSummaries(userId, characterId)`: poppy `MemorySummary` has no
     `period` column, so fetch the newest N summaries by `periodEnd` for the
     pair under a `CHAR_BUDGET` (~1200 tokens * 4), oldest -> newest, with a
     `truncated` flag when over budget (drop oldest first). Pure fetch, no LLM.
     `formatTieredSummaries(summaries, timezone)` keeps the date-range labels
     via `Intl.DateTimeFormat`. Behind `memoryTieredContextEnabled()`;
     flag-off returns the single latest summary (byte-identical to today's
     `getLatestSummary`).

10. **Wire the chat turn: `backend/src/chat/engine.ts` (`runChatTurn`).**
    - **Retrieval read (~line 159):** when `memoryGraphEnabled()`, call
      `getRelevantMemoriesWithGraph({...})` instead of `getRelevantMemories`,
      pass its `connections` into `renderMemoryBlock`/`renderMemoryBlockWithConnections`
      so `injectedMemory` gains the CONNECTIONS block. Flag-off path calls the
      existing `getRelevantMemories` UNCHANGED. Keep the existing try/catch that
      degrades to `injectedMemory = null` on failure.
    - **Extraction trigger (~line 269):** LEAVE the existing
      `void extractMemories({ ..., sourceMessageId: assistantMessage.id }).catch(...)`
      in place. It now drives entity/edge writes via step 3 automatically. Do
      NOT duplicate it.
    - **Optional fire-and-forget (after the atomic write, wrapped, never
      blocking):** `void buildUserPersona(userId, conv.characterId).catch(...)`
      on a `shouldBootstrapPersona` threshold, and
      `void captureRule(userId, conv.characterId, userText, userMessageId).catch(...)`
      when `userRulebookEnabled()`. All behind flags; a failure must never
      affect the streamed reply.
    - Do NOT add `dreaming` to the hot path; it runs from a scheduled job
      (add a script `backend/src/scripts/run-dreaming.ts` calling
      `runDreamingForAllPairs()` for local/manual invocation).

11. **Prisma client + typecheck.** `npm run -w @buttercupp/database generate`
    (or the repo's generate script) so `prisma.memoryEntity` / `prisma.memoryEdge`
    types exist, then `npm run typecheck`. Run `npm run check:no-em-dash`.

## Test instructions
```
# Prisma types regenerated first
npm run -w @buttercupp/database generate
npm run typecheck

# Vitest (backend). DB-backed cases guarded with describe.skipIf(!DB_UP).
npm run test -w backend -- memory-extractor
npm run test -w backend -- memory-retriever
npm run test -w backend -- dreaming
npm run test -w backend -- rulebook
npm run test -w backend -- graph

# e2e (baseURL http://localhost:3000, local stack up)
npm run test:e2e -- memory-graph
```
Vitest cases:
- **entity + edge creation (`backend/src/llm/__tests__/memory-graph.extractor.test.ts`, `skipIf(!DB_UP)`):**
  mock `callLLM` to return a candidate with `people: [{ name:"Sam", relation:"sister", sentiment:0.6 }]`;
  with `memoryGraphEnabled()` on, assert exactly one `MemoryEntity` row for
  `(userId, characterId, kind:"person", normalizedName:"sam")` and one
  `about_person` edge from the new memory to that entity. A second turn naming
  "Sam" again must NOT create a duplicate entity (upsert) but MAY reinforce
  relation/sentiment.
- **extends edges to neighbors:** seed two semantically-close memories, extract
  a third close one, assert an `extends` edge (weight > 0.6) links it to a
  neighbor; assert no `extends` edge when neighbors are dissimilar.
- **graph-aware retrieval (`memory-graph.retriever.test.ts`, `skipIf(!DB_UP)`):**
  seed memory A (fact) + memory B (about the same person) linked by an
  `about_person`/`extends` edge; call `getRelevantMemoriesWithGraph` with a
  query that vector-hits A only; assert B is pulled in as a graph neighbor
  (present in `scored` beyond the base result) and a `connection` is returned;
  assert base `getRelevantMemories` for the same query does NOT include B
  (proves the graph is the added signal).
- **base scoring unchanged:** with `memoryGraphEnabled()` OFF,
  `getRelevantMemoriesWithGraph` returns exactly `getRelevantMemories` and no
  connections (byte-identical seed set, same order, same scores).
- **isolation per (user, character):** an entity/edge written for
  `(userA, char1)` is never returned by `getRelevantMemoriesWithGraph` for
  `(userA, char2)` nor `(userB, char1)`. Confirms the `characterId` predicate
  on entity + edge reads.
- **no duplicate entities under concurrency:** call the extractor graph path
  twice concurrently (`Promise.all`) for the same person; assert exactly one
  `MemoryEntity` row exists (upsert on the unique key).
- **dreaming clustering (pure, no DB):** `dreaming._internal.clusterMemories`
  on fixed embeddings produces deterministic clusters across runs.
- **embedding dim == 384 (pure):** `embed("hello world")` length ===
  `EMBEDDING_DIM === 384` (skip the length assert only when `embed` returns
  null because the model is unavailable).

MANUAL:
1. `docker compose up` the local Postgres+pgvector, run the local migration
   (`prisma migrate dev`), boot backend + frontend.
2. Set `MEMORY_GRAPH_ENABLED=true` in the local backend env.
3. Open a chat with one character. Turn 1: "My sister Sam just moved to Berlin
   for a design job." Send 3-4 unrelated turns.
4. `psql` the local DB: `SELECT name, relation, sentiment FROM "MemoryEntity"
   WHERE "characterId" = '<charId>';` -> expect a `Sam` / `sister` row.
   `SELECT relation, "createdBy" FROM "MemoryEdge" WHERE "characterId" = '<charId>';`
   -> expect an `about_person` edge and (once similar memories exist) `extends`
   edges.
5. Turn N: "How's Sam doing?" Dump the composed system prompt (dev log) and
   confirm the injected memory block recalls the Berlin/design fact via the
   entity link and shows a `Connections:` line.
6. Start a chat with a SECOND character as the same user and ask "Who is Sam?";
   confirm the first character's Sam facts do NOT appear (isolation).
7. (Optional) run `tsx backend/src/scripts/run-dreaming.ts` and re-query
   `MemoryEdge` for `createdBy = 'dreaming'` rows.

## Sanity checklist
- [ ] A single chat turn that names a person creates one `MemoryEntity` and an
      `about_person` `MemoryEdge`, both scoped to `(userId, characterId)`.
- [ ] Extraction still fires from the chat turn (`engine.ts` ~line 269,
      fire-and-forget) and now populates entities/edges via the extractor's
      graph block; a graph write failure neither throws nor blocks the reply.
- [ ] `getRelevantMemoriesWithGraph` recalls an entity-linked memory that the
      base `getRelevantMemories` misses, and returns a `Connections` block; the
      base scoring/weights/thresholds are UNCHANGED (graph is additive only).
- [ ] Naming the same person twice does NOT create a duplicate entity (upsert
      on `(userId, characterId, kind, normalizedName)`), even under concurrency.
- [ ] Isolation holds: entities/edges for `(userA, char1)` never surface for
      `(userA, char2)` or `(userB, char1)`.
- [ ] Flag-off (`memoryGraphEnabled()` false) is byte-identical to today: no
      graph reads/writes, `getRelevantMemoriesWithGraph` == `getRelevantMemories`.
- [ ] Migration is additive (`MemoryEntity`, `MemoryEdge`, plus any
      `EmotionalPattern`/`UserPersona`/`UserRule` you chose); no change to
      `Memory`/`MemorySummary` vector columns; applied to a LOCAL DB only.
- [ ] `embed()` still returns 384-dim vectors; `EMBEDDING_DIM === 384`.
- [ ] `npm run typecheck` and `npm run check:no-em-dash` pass; ported modules
      import poppy utils (`log`, `metrics`, `flags`, `safe-types`, `retry`),
      never `@karoli/database` or Pellow-only subsystems.

## Done criteria
"Green" = the entity/edge extractor and graph retriever Vitest suites pass
(or skip cleanly with no DB); a multi-turn conversation builds a
`MemoryEntity` + `MemoryEdge` graph and a later turn recalls a fact via the
entity link with a `Connections` block; per-`(user, character)` isolation
holds; the flag-off path is byte-identical to Phase 05/23; the extraction
trigger remains wired in `runChatTurn` and drives graph writes; embeddings are
384-dim; the additive migration is applied locally only; `typecheck` and
`check:no-em-dash` are clean. The Supermemory + Mem0 lineage is noted in the
schema and retriever comments.

## Guardrail note
STOP before any commit, push, non-local DB migration (this phase adds
`MemoryEntity`, `MemoryEdge`, and optionally `EmotionalPattern`/`UserPersona`/
`UserRule`; applying that migration to any hosted/prod database requires
explicit, fresh, per-action human approval), secret write, or ECS/Amplify
deploy. Local work (edits, local Postgres `prisma migrate dev`, local tests,
local dev server, `tsx backend/src/scripts/run-dreaming.ts` against a local DB)
proceeds without it. Prior approval never carries to the next action; ask again
for each prod-touching step.
