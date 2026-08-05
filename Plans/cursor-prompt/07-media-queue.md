# Phase 07 - Async media orchestration (queue + worker + S3 + WS push)

## Goal
Build the **generic async media pipeline** that all rich-media generation runs on. This phase does NOT generate voice or images itself. It delivers the reusable machinery: a BullMQ + Redis job queue, a worker process, the `MediaAsset` lifecycle in Postgres, S3 upload + CloudFront signed-URL retrieval, a `media.ready` push over the phase-04 WebSocket gateway, and an atomic `TokenLedger` debit per job with an insufficient-balance paywall response. Phases 08 (voice) and 09 (image) plug concrete job handlers into this pipeline.

The hard contract: **chat is never blocked by a media job**. A media request enqueues a job and returns immediately with a `jobId`; the result arrives later over WebSocket.

Reference: PRD §7.2(2) (async media queue divergence), §11 (media pipeline), §5.8 (token accounting), §9.2 (WS event contract).

## Prerequisites
- Phase 00 green: monorepo, `packages/database` Prisma singleton (`import { prisma } from "@buttercupp/database"`), `packages/shared` Zod DTOs, `backend/src/utils/retry.ts` with `RETRY_PRESETS`, `config/flags.ts`, `audit.ts`.
- Phase 02 green: `MediaAsset`, `TokenLedger`, `Conversation`, `Message` tables exist in the Prisma schema.
- Phase 04 green: WebSocket gateway on ECS with per-connection auth (cookie JWT) and a way to emit server->client events to a given user/connection.
- Local Redis reachable via `REDIS_URL` (ElastiCache in prod; `redis://localhost:6379` locally).
- Local S3 target: real S3 bucket or MinIO/LocalStack via `S3_ENDPOINT` override.

## Context to paste into Cursor
```
You are implementing Phase 07 of ButterCupp (see prds/master-prd.md §7.2(2), §11, §5.8, §9.2).

Build the GENERIC async media pipeline only. Voice (Phase 08) and image (Phase 09) plug handlers into it later. Do not implement provider calls now; use a mock generator behind the handler interface.

Mirror Pellow conventions:
- Prisma singleton: import { prisma } from "@buttercupp/database". Never new PrismaClient().
- Retry/backoff via RETRY_PRESETS + withRetry from backend/src/utils/retry.ts (../Pellow/backend/src/utils/retry.ts). Add a "media" preset.
- Provider-chain + graceful-degradation shape mirrors ../Pellow/backend/src/media/voice.ts (per-provider try/catch, session disable flags), but here it is the QUEUE that owns retries, not the handler.
- Zod DTOs live in packages/shared. TypeScript strict. Server-side validation on every mutation.
- No em dashes anywhere.

Key rule: enqueue returns immediately with jobId; chat is never blocked. Result is pushed over the Phase-04 WebSocket as media.ready { mediaAssetId, url }.

MediaAsset lifecycle: queued -> processing -> ready | failed.
Token rule: debit TokenLedger atomically when the job STARTS work; on failure, refund. Insufficient balance -> do not enqueue, return a paywall response.
```

## Build steps

1. **Shared DTOs**: `packages/shared/src/media.ts`
   - `MediaKind = "image" | "voice" | "video"` (video is Phase-2, keep the enum slot).
   - `MediaJobData` Zod schema: `{ mediaAssetId, userId, conversationId, characterId, kind, tokenCost, payload }` where `payload` is an opaque `Record<string, unknown>` (per-kind handlers own its shape).
   - `EnqueueMediaRequest` / `EnqueueMediaResponse` (`{ jobId, mediaAssetId, status: "queued" }`).
   - `MediaReadyEvent` (matches PRD §9.2 `media.ready { mediaAssetId, url }`, plus `kind`, `conversationId`).
   - Export a `MEDIA_QUEUE_NAME = "buttercupp-media"` constant.

2. **Redis connection factory**: `backend/src/queue/connection.ts`
   - `getRedisConnection()` returns a lazily-created `ioredis` client from `REDIS_URL` with `maxRetriesPerRequest: null` (BullMQ requirement) and `enableReadyCheck: false`.
   - Single shared connection for the queue; workers get their own (BullMQ needs a dedicated blocking connection).
   - Graceful no-op / clear error when `REDIS_URL` is unset (mirror the "provider unconfigured" pattern in voice.ts).

3. **Queue definition**: `backend/src/queue/media-queue.ts`
   - Export a BullMQ `Queue` bound to `MEDIA_QUEUE_NAME`.
   - `defaultJobOptions`: `attempts: 3`, `backoff: { type: "exponential", delay: 2000 }` (mirror `RETRY_PRESETS.llm` numbers), `removeOnComplete: 100`, `removeOnFail: 500`.
   - Export `enqueueMediaJob(data: MediaJobData): Promise<{ jobId }>`.

4. **Token debit (atomic)**: `backend/src/media/token-ledger.ts`
   - `debitTokens(userId, delta, reason, refId)`: run inside `prisma.$transaction`. Read current balance, throw `InsufficientTokensError` if `balance < delta`, then decrement `User.tokenBalance` and insert a `TokenLedger` row with `balanceAfter`. Use a conditional `updateMany` guard (`where: { id, tokenBalance: { gte: delta } }`) so a concurrent debit cannot drive the balance negative, the transaction is the atomicity boundary.
   - `refundTokens(userId, delta, reason, refId)`: inverse ledger entry with positive delta, used on job failure.
   - `reason` values from PRD §8: `image_gen | voice_gen | premium_msg | grant | purchase`.
   - Export `InsufficientTokensError` (carries the shortfall so the route can build a paywall response).

5. **MediaAsset lifecycle helpers**: `backend/src/media/asset.ts`
   - `createQueuedAsset({ userId, characterId, kind, meta })` -> inserts `MediaAsset` with `status: "queued"`, returns the row.
   - `markProcessing(id)`, `markReady(id, s3Key, meta)`, `markFailed(id, error)`, narrow status transition helpers, each a single `prisma.mediaAsset.update`.
   - Guard illegal transitions (e.g. ready -> processing) and log via `audit.ts`.

6. **S3 + CloudFront**: `backend/src/media/storage.ts`
   - `uploadMedia(buffer, { userId, kind, contentType })`: PUT to S3 under key `media/{userId}/{kind}/{uuid}.{ext}`; support `S3_ENDPOINT` override for MinIO/LocalStack. Returns the `s3Key`.
   - `getSignedUrl(s3Key)`: CloudFront signed URL via `CLOUDFRONT_KEY_PAIR_ID` + `CLOUDFRONT_PRIVATE_KEY`, TTL ~15 min. When CloudFront envs are absent (local), fall back to an S3 presigned URL so dev works without CDN.

7. **Handler registry**: `backend/src/media/handlers/index.ts`
   - `MediaHandler` interface: `(job: MediaJobData) => Promise<{ buffer: Buffer; contentType: string; meta: Record<string, unknown> }>`.
   - `handlers: Record<MediaKind, MediaHandler>`. For THIS phase register a `mockHandler` for every kind that returns a tiny fixed buffer (e.g. 1x1 PNG / short silence) so the pipeline is testable end to end. Phases 08/09 swap in the real voice/image handlers.

8. **Worker process**: `backend/src/queue/media-worker.ts`
   - BullMQ `Worker` on `MEDIA_QUEUE_NAME`, own Redis connection, `concurrency` from `MEDIA_WORKER_CONCURRENCY` (default 4).
   - Per job: `markProcessing` -> `debitTokens` (inside try; on `InsufficientTokensError` -> `markFailed` + do not retry) -> look up `handlers[kind]` -> run handler wrapped in `withRetry(..., RETRY_PRESETS.media)` -> `uploadMedia` -> `markReady` -> emit `media.ready` over WS.
   - On terminal failure (attempts exhausted): `markFailed` + `refundTokens` + emit an `error` event to the user. Increment a metric counter per outcome (mirror Pellow `metrics.ts` shape).
   - Add `RETRY_PRESETS.media` to `backend/src/utils/retry.ts` (`maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 8000`, no retry on 401/403).

9. **WS bridge**: `backend/src/queue/ws-notify.ts`
   - `notifyMediaReady(userId, event: MediaReadyEvent)` and `notifyMediaError(userId, ...)` call into the Phase-04 gateway's user->connection emit. Since the worker may run in a separate process/task, publish via a Redis pub/sub channel (`buttercupp:ws:{userId}`) that the gateway subscribes to. This is the ECS scale-out fan-out noted in PRD §18.

10. **Enqueue route**: `backend/app/api/media/[kind]/route.ts` (or backend REST handler)
    - Validate `EnqueueMediaRequest` with Zod. Auth via cookie JWT (Phase 01). Resolve `tokenCost` for the kind from a `MEDIA_TOKEN_COSTS` map in `packages/shared`.
    - Pre-check balance: if `User.tokenBalance < tokenCost`, return `402` with a normalized paywall body `{ error: "insufficient_tokens", required, balance, buyTokensUrl }` (do NOT enqueue). Actual debit still happens atomically in the worker; this is a fast fail for UX.
    - Else `createQueuedAsset` -> `enqueueMediaJob` -> return `EnqueueMediaResponse` with `jobId` + `mediaAssetId`.
    - Maps to PRD §9.1 `POST /api/media/image`, `POST /api/media/voice`.

11. **Status route**: `backend/app/api/media/[id]/route.ts`
    - `GET` returns the `MediaAsset` status and, when `ready`, a fresh signed URL (PRD §9.1 `GET /api/media/:id`). Ownership check: caller must own the asset.

12. **Worker entrypoint + Docker**: `backend/src/worker.ts` + note in `backend/Dockerfile`
    - Standalone entrypoint that boots `media-worker.ts` and the Redis subscriber. Document running it as a separate ECS task OR the same task as the API (PRD §14). Add `npm run worker` script.

## Test instructions
```
# Unit + integration (Vitest), from repo root
npm run test -w backend -- media

# Requires local Redis + S3 target:
docker compose up -d redis minio   # or your local equivalent
REDIS_URL=redis://localhost:6379 npm run test -w backend -- media
```
Vitest cases to author (`backend/src/media/__tests__/`, `backend/src/queue/__tests__/`):
- **enqueue**: `enqueueMediaJob` creates a `queued` MediaAsset and returns a `jobId`.
- **worker happy path**: worker picks up the job, runs the `mockHandler`, MediaAsset transitions `queued -> processing -> ready`, S3 key set, signed URL resolves.
- **token debit atomic**: balance decremented exactly by `tokenCost`, a `TokenLedger` row written with correct `balanceAfter`; two concurrent jobs on the same user never drive balance negative.
- **insufficient balance**: enqueue route returns `402` paywall body when balance < cost; worker `debitTokens` throws `InsufficientTokensError` and marks the asset `failed` without retry.
- **failure + refund**: handler throws on all attempts -> asset `failed`, tokens refunded (net-zero ledger), `error` emitted.
- **integration**: enqueue -> worker -> assert a `media.ready` event is published on `buttercupp:ws:{userId}` and delivered to a subscribed fake gateway connection.

## Sanity checklist
- [ ] Requesting media returns a `jobId` immediately; the chat WebSocket keeps streaming tokens with no stall (chat never blocked by a media job).
- [ ] A completed job flips MediaAsset to `ready` and a `media.ready` event arrives at the client over WS.
- [ ] Token balance drops by exactly `tokenCost` on success; ledger `balanceAfter` matches `User.tokenBalance`.
- [ ] A failed job marks the asset `failed` AND refunds tokens (balance back to pre-job value).
- [ ] Insufficient balance never enqueues; returns a `402` paywall response.
- [ ] S3 keys resolve to a working signed URL (CloudFront in prod, presigned S3 locally); URL expires.
- [ ] Worker survives a handler throw without crashing the process; other jobs keep flowing.

## Done criteria
- Generic pipeline runs end to end with the mock handler: enqueue -> worker -> S3 -> signed URL -> `media.ready` over WS.
- Atomic debit + refund proven by tests, including the concurrent-debit guard.
- `RETRY_PRESETS.media` added; worker uses it.
- Phase 08 and Phase 09 can register a real handler in `handlers/index.ts` with zero changes to queue/worker/token/S3 code.

## Guardrail note
STOP before any commit, push, non-local DB migration (`prisma migrate deploy` against RDS), Redis/S3 provisioning on AWS, or ECS deploy. Each requires an explicit, fresh, per-action human approval. Local-only: file edits, `prisma migrate dev` against a local DB, local Redis/MinIO, Vitest. Never assume prior approval carries over to the next action.
