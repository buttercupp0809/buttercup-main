# Phase 02: Data model

## Goal
Deliver the complete Prisma schema for every model in PRD §8, with relations, enums, and pgvector columns + indexes for `Memory.embedding` and `MemorySummary.embedding`. Wire the local migration workflow (`db:migrate` / `db:push` / `db:studio`, mirroring Pellow), enable the pgvector extension, port the `audit.ts` fire-and-forget writer now that `AuditLog` exists, and add a seed script that creates a small roster of system-owned characters. After this phase the schema is the single source of truth all later phases (gallery, chat, memory, wizard, media, billing, safety) build against, and `@buttercupp/database` imports resolve from both `frontend/` and `backend/`.

This phase covers PRD §8 (data model).

## Prerequisites
- Phase 00 green: `@buttercupp/database` singleton + migrations dir.
- Phase 01 green: `User`, `AgeVerification`, `MagicLink` models already exist. This phase EXTENDS them to the full §8 shape and adds every remaining model. Do not redeclare models Phase 01 created; reconcile field names (they were chosen to match §8).
- Local Postgres 16 with pgvector available via `DATABASE_URL`. All migrations run LOCALLY only.

## Context to paste into Cursor
```
You are building Phase 02 of "ButterCupp": the full data model.

Authoritative spec: prds/master-prd.md §8 (data model, Prisma outline). pgvector-indexed fields are Memory.embedding and MemorySummary.embedding. All ids cuid/uuid, timestamps on every table.

Mirror Pellow's Prisma conventions:
- ../Pellow/packages/database/prisma/schema.prisma, generator client block (previewFeatures ["driverAdapters"], binaryTargets ["native","rhel-openssl-3.0.x","linux-arm64-openssl-3.0.x"]); datasource postgresql; pgvector columns declared as `embedding Unsupported("vector(N)")?`; @@index patterns; enums modeled either as Prisma enums or string fields with defaults (prefer real Prisma enums for the closed sets ButterCupp calls out).
- ../Pellow/packages/database/src/client.ts + src/index.ts, the singleton already exists from Phase 00; do not touch it beyond re-exporting new enums/types.
- ../Pellow/backend/src/utils/audit.ts, port the fire-and-forget writeAuditLog + auditContext now that AuditLog exists.

Decide embedding dimension by the model you standardize on. Pellow uses vector(384) (bge-small class). ButterCupp's RAG (Phase 05) will use a specific embedder; pick ONE dimension now (recommend vector(1536) for OpenAI text-embedding-3-small, OR vector(384) if using a local small model) and use it consistently for Memory.embedding and MemorySummary.embedding. Document the choice in a comment; changing it later means a migration.

Hard rules: never new PrismaClient() outside packages/database/src/client.ts; import { prisma } from "@buttercupp/database"; TypeScript strict; no em dashes. Do NOT run git commit/push, deploy, or migrate a non-local DB. `npm run db:migrate` is LOCAL only.
```

## Build steps

### 1. Enums (Prisma `enum` blocks)
In `packages/database/prisma/schema.prisma`, define the closed sets from §8 as real Prisma enums:
- `SubscriptionTier { free premium pro }`
- `ContentRating { sfw mature }`
- `Visibility { private public }`
- `CharacterStyle { realistic threeD anime }` (map `threeD` to the "3d" concept; the value name cannot start with a digit)
- `ModerationStatus { pending approved rejected }`
- `MemoryTier { hot warm cold }`
- `MediaKind { image voice video }`
- `MediaStatus { queued processing ready failed }`
- `TokenReason { purchase image_gen voice_gen premium_msg grant }`
- `MessageRole { user assistant system }`
- `AgeVerificationLevel { none self_declared vendor_verified }`
Use these enums on the relevant columns below.

### 2. Models (full §8 set)
Add/extend these models in `schema.prisma`. Every model has an id (`@default(uuid())` or cuid), `createdAt`, and `updatedAt` where mutable.

- `User` (extend Phase 01), `email @unique`, `passwordHash?`, `oauthProvider?`, `googleId? @unique`, `dob DateTime?`, `jurisdiction String?`, `subscriptionTier SubscriptionTier @default(free)`, `tokenBalance Int @default(0)`, `ageVerifiedAt DateTime?`, `ageVerificationLevel AgeVerificationLevel @default(none)`, `tosAcceptedAt?`, `privacyAcceptedAt?`. Relations: `characters Character[]` (owned), `ageVerifications AgeVerification[]`, `conversations Conversation[]`, `memories Memory[]`, `memorySummaries MemorySummary[]`, `relationshipStates RelationshipState[]`, `subscription Subscription?`, `tokenLedger TokenLedger[]`, `mediaAssets MediaAsset[]`, `crisisEvents CrisisEvent[]`, `magicLinks MagicLink[]`.
- `AgeVerification`. `userId`, `provider`, `level AgeVerificationLevel`, `status`, `evidenceRef?`, `verifiedAt?`, relation to User, `@@index([userId])`.
- `Character`. `ownerUserId?` (null = system), `name`, `age Int` (18+ enforced in app + a seed guard), `gender`, `bio`, `tags String[]`, `style CharacterStyle`, `contentRating ContentRating @default(sfw)`, `visibility Visibility @default(private)`, `moderationStatus ModerationStatus @default(pending)`, `currentVersionId?`, `popularityScore Float @default(0)`. Relations: `owner User? @relation(...)`, `versions CharacterVersion[]`, `conversations Conversation[]`. `@@index([visibility, moderationStatus])`, `@@index([contentRating])`, `@@index([popularityScore])`, `@@index([ownerUserId])`.
- `CharacterVersion`. `characterId`, `versionNo Int`, `personality`, `backstory`, `behavioralInstructions`, `greeting`, `appearanceSheetId?`, `voiceProfileId?`, `systemPromptSnapshot`. Relations: `character`, `appearanceSheet AppearanceSheet? @relation`, `voiceProfile VoiceProfile? @relation`, `conversations Conversation[]` (pinned). `@@unique([characterId, versionNo])`, `@@index([characterId])`.
- `AppearanceSheet`. `traits Json` (hair/eye/body/features/clothing), `stylePrompt`, `negativePrompt`, `referenceImageKeys String[]`, `loraRef?`.
- `VoiceProfile`. `provider`, `voiceId`, `params Json`, `previewKey?`.
- `Conversation`. `userId`, `characterId`, `characterVersionId` (pinned), `lastMessageAt DateTime?`, `messageCount Int @default(0)`. Relations to User, Character, CharacterVersion, `messages Message[]`. `@@index([userId, lastMessageAt])`, `@@index([characterId])`, `@@unique([userId, characterId])` (one conversation per user x character; adjust if multiple threads are desired later).
- `Message`. `conversationId`, `role MessageRole`, `content String`, `mediaAssetId?`, `tokenCost Int?`, `createdAt`. Relations: `conversation`, `mediaAsset MediaAsset? @relation`. `@@index([conversationId, createdAt])`.
- `Memory` (pgvector), `userId`, `characterId`, `content`, `category`, `embedding Unsupported("vector(N)")?`, `tier MemoryTier @default(hot)`, `salience Float @default(0.5)`, `sourceMessageId?`. Relations to User. `@@index([userId, characterId])`, `@@index([userId, characterId, tier])`. Add the HNSW/IVFFlat vector index via raw SQL migration (see step 4).
- `MemorySummary` (pgvector), `userId`, `characterId`, `periodStart DateTime`, `periodEnd DateTime`, `summary`, `embedding Unsupported("vector(N)")?`. `@@index([userId, characterId])`.
- `RelationshipState`. `userId`, `characterId`, `affectionLevel Int @default(0)`, `milestones String[]`, `mood String?`, `updatedAt`. `@@unique([userId, characterId])`.
- `Subscription`. `userId @unique`, `provider`, `tier SubscriptionTier @default(free)`, `status String @default("inactive")`, `currentPeriodEnd DateTime?`, `externalId?`. `@@index([provider, status])`.
- `TokenLedger`. `userId`, `delta Int`, `reason TokenReason`, `balanceAfter Int`, `refId?`, `createdAt`. `@@index([userId, createdAt])`.
- `MediaAsset`. `userId`, `characterId?`, `kind MediaKind`, `s3Key?`, `status MediaStatus @default(queued)`, `jobId?`, `meta Json?`. `@@index([userId, createdAt])`, `@@index([status])`, `@@index([jobId])`.
- `CrisisEvent`. `userId`, `level Int`, `trigger String`, `action String`, `createdAt`. `@@index([userId])`, `@@index([level])`.
- `AuditLog`. `userId?`, `actorId?`, `action`, `resource?`, `metadata Json?`, `ip?`, `userAgent?`, `createdAt`. No FK relation (logs survive user deletion). `@@index([userId, createdAt])`, `@@index([action, createdAt])`.
- `AnalyticsEvent`. `userId?`, `name String`, `props Json?`, `createdAt`. `@@index([name])`, `@@index([userId])`, `@@index([createdAt])`.
- `FeatureFlag`. `key @unique`, `enabled Boolean @default(false)`, `rollout Int @default(0)`, `metadata Json?`.
- `MagicLink` (from Phase 01), keep as-is (`tokenHash @unique`, `purpose`, `expiresAt`, `consumedAt`).

### 3. Regenerate types + re-export enums
- `packages/database/src/types.ts`. re-export the new Prisma enums (`SubscriptionTier`, `ContentRating`, `Visibility`, `CharacterStyle`, `ModerationStatus`, `MemoryTier`, `MediaKind`, `MediaStatus`, `TokenReason`, `MessageRole`, `AgeVerificationLevel`) so both frontend and backend consume them from `@buttercupp/database`.
- Keep `@buttercupp/shared` string-literal unions in sync with these enum values (Phase 00 seeded `SubscriptionTier`/`ContentRating`/`Visibility`); add the rest.

### 4. pgvector extension + vector indexes (raw SQL in the migration)
- Ensure the migration enables the extension: `CREATE EXTENSION IF NOT EXISTS vector;` (Prisma cannot express this from the schema; add it to the generated migration SQL or run it before `db:migrate` against the LOCAL db).
- Add vector indexes for similarity search on both embedding columns, e.g.:
  - `CREATE INDEX IF NOT EXISTS memory_embedding_idx ON "Memory" USING hnsw (embedding vector_cosine_ops);`
  - `CREATE INDEX IF NOT EXISTS memory_summary_embedding_idx ON "MemorySummary" USING hnsw (embedding vector_cosine_ops);`
  (Use `ivfflat` instead of `hnsw` if the local pgvector build predates HNSW; document which and why.)
- Put these in a hand-edited migration step so they are reproducible; do not rely on `db push` for the extension.

### 5. Audit writer
- `backend/src/utils/audit.ts`. port `../Pellow/backend/src/utils/audit.ts`: `auditContext(req)` (extract ip + user-agent from a Node request) and `writeAuditLog(params)` (fire-and-forget, never throws, never blocks, no raw PII beyond userId). Uses `import { prisma } from "@buttercupp/database"`.

### 6. Seed script (system-owned characters)
- `packages/database/prisma/seed.ts`. create a small roster (3 to 5) of `Character` rows with `ownerUserId = null` (system-owned), each with a `CharacterVersion` (personality/backstory/greeting/systemPromptSnapshot), an `AppearanceSheet`, and a `VoiceProfile`. Set `currentVersionId`, `visibility = public`, `moderationStatus = approved`, `contentRating` mixed (`sfw` and `mature`), varied `style`. All ages 18+. Make the seed idempotent (upsert by a stable natural key like name).
- Wire `packages/database/package.json` `prisma.seed` config and a `db:seed` root script (`npm run seed --workspace=@buttercupp/database`).

### 7. Local migration
- Run `npm run db:migrate` (prisma migrate dev) against LOCAL Postgres only. Then `npm run db:seed`.

## Test instructions
```
# Local test DB (never a shared/prod DB). Point TEST_DATABASE_URL at a local db, e.g. buttercupp_test.
createdb buttercupp_test 2>/dev/null || true
psql "$TEST_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Apply the schema to the local test DB
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate

# Unit / integration (Vitest against the local test DB)
npm test -- data-model      # covers:
# - prisma migrate applied clean; all §8 tables exist
# - basic CRUD: create a User, a system Character + CharacterVersion (+ AppearanceSheet + VoiceProfile), a Conversation, a Message
# - enum round-trip: writing/reading SubscriptionTier, ContentRating, MediaStatus, TokenReason
# - a pgvector similarity query returns rows: insert two Memory rows with embeddings, run
#   `SELECT id FROM "Memory" ORDER BY embedding <=> $queryVec LIMIT 1` (via $queryRaw) and assert a row comes back
# - the vector index exists: query pg_indexes for memory_embedding_idx

# Seed check
DATABASE_URL="$TEST_DATABASE_URL" npm run db:seed
psql "$TEST_DATABASE_URL" -c 'SELECT count(*) FROM "Character" WHERE "ownerUserId" IS NULL;'   # >= 3

# Singleton import resolves from both workspaces
npm run typecheck
```

## Sanity checklist
- [ ] `prisma migrate dev` runs clean against LOCAL Postgres; every §8 model + enum exists.
- [ ] pgvector extension enabled; `Memory.embedding` and `MemorySummary.embedding` are `vector(N)` with the SAME N, documented.
- [ ] Vector indexes exist (`memory_embedding_idx`, `memory_summary_embedding_idx`); a `<=>` similarity `$queryRaw` returns rows.
- [ ] All enums are real Prisma enums and are re-exported from `@buttercupp/database`; `@buttercupp/shared` unions match the enum values.
- [ ] Relations are correct (User -> Character/Conversation/Memory/..., Character -> CharacterVersion -> AppearanceSheet/VoiceProfile, Conversation -> Message).
- [ ] `AuditLog` has no FK relation (survives user deletion); `writeAuditLog` is fire-and-forget and never throws.
- [ ] Seed creates >= 3 system-owned characters (`ownerUserId = null`), each with a version + appearance sheet + voice profile, all ages 18+; seed is idempotent.
- [ ] `import { prisma } from "@buttercupp/database"` type-checks from both `frontend/` and `backend/`; no `new PrismaClient()` outside the singleton.
- [ ] `npm run typecheck` passes; no em dashes in the diff.

## Done criteria
The full PRD §8 schema is migrated locally with pgvector enabled and vector indexes in place. Enums are shared through `@buttercupp/database`. A local test-DB Vitest run exercises migrate + CRUD + a working similarity query. The seed produces a small system-character roster. `@buttercupp/database` singleton imports resolve from both workspaces. Downstream phases (gallery, chat, memory, wizard, media, billing, safety) now have their tables.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy, or migration against a non-local database. `npm run db:migrate`, `db:push`, `db:seed`, and `psql` are allowed ONLY against your LOCAL Postgres (including a local `buttercupp_test`). Never point `DATABASE_URL`/`TEST_DATABASE_URL` at a shared, staging, or production database in this phase. When unsure whether a target DB is non-local, assume it is and ask first.
