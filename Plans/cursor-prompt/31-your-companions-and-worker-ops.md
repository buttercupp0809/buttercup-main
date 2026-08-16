# Phase 31: "Your Companions" section + BullMQ media-worker operational fix

## Goal
Two connected deliverables:

1. **"Your Companions" (net-new, additive).** Add a new primary-nav section, "Your Companions", that lists every companion the signed-in user created, with its avatar, name, live image-generation status, a "Chat" action, and a "Regenerate images" action. This is the per-user view of characters a user owns. It must match the existing dark app-shell design language exactly.

2. **BullMQ media-worker operational fix (repair + hardening, NOT re-architecture).** The reason a freshly created character shows no image LOCALLY is that the BullMQ media worker process was not running (no `REDIS_URL` / `npm run worker` not up), so enqueued creation-image jobs were never processed. The same class of failure is possible in PROD if the `buttercupp-worker` ECS service is down, mis-configured, or crash-looping. This phase (a) documents the exact local run + the read-only prod diagnosis runbook, (b) adds observability so a dead worker is visible instead of silent, and (c) makes the UI degrade gracefully and offer retry when the queue is unavailable.

**Critical framing (do not regress):** The create-time image pipeline itself is CORRECT as of Phase 28. `frontend/app/api/characters/[id]/generate-images/route.ts` enqueues through the backend BullMQ queue (it no longer spawns `persona_pipeline.py`), and `backend/src/queue/media-worker.ts` (lines ~94-112) already dual-writes both the `MediaAsset` lifecycle row AND the canonical `CharacterMedia` row on ready. Do NOT rewrite the pipeline, do NOT re-introduce an inline/second image path, do NOT change the `MediaAsset` / `CharacterMedia` split. The break is operational (process not running), not architectural.

**Hard architecture-preservation rule:** The production stack is frozen and known-good (frontend Amplify `WEB_COMPUTE`, backend + worker on ECS Fargate, RDS Postgres, ElastiCache Redis, Prisma native-engine wiring, 18 Amplify env vars). Nothing in this phase may alter the Prisma schema, the Prisma client/engine wiring, the Amplify build, or any of the 18 env vars. "Your Companions" is a purely additive read view over existing ownership (`Character.ownerUserId`); it needs NO migration.

Reference: Phase 07 (media queue + worker + S3), Phase 09 (image gen), Phase 17 (app shell + sidenav), Phase 28 (creation-pipeline unification). PRD §5.6 (image/selfie generation), §5.7 (wizard), §11 (media pipeline).

## Prerequisites
- Phase 17 green: app shell + sidenav. Nav is a data array `APP_NAV` in `frontend/components/app-shell/nav-items.ts`; icons map by `NavIcon` key in `frontend/components/app-shell/SideNav.tsx` (and the mobile nav). Active state is derived in `SideNav.tsx` (`pathname === item.href || pathname.startsWith(item.href + "/")`). Links render through `frontend/components/app-shell/NavItemLink.tsx` (gradient border/wash for free).
- Phase 28 green: `frontend/app/api/characters/[id]/generate-images/route.ts` (enqueue; owner-checked; returns `{ status: "queued", assetIds }` or `{ status: "unavailable" }`), `backend/src/queue/media-worker.ts` (dual-write), `backend/src/queue/{media-queue.ts,connection.ts}`, `backend/src/media/asset.ts`.
- Ownership already exists: `Character.ownerUserId` (nullable, indexed) with relation `User.characters @relation("CharacterOwner")`. System personas have `ownerUserId = null`; user-created companions have `ownerUserId = <user>`. NO new table, NO new column, NO migration.
- Media split (do not change): `MediaAsset` carries the queue lifecycle (`status: queued|processing|ready|failed`, `s3Key`, `jobId`, `kind`) and is what gallery/status reads. `CharacterMedia` carries the canonical persona images (`url`, `isPrimary`, `isDisplay`, `sort`) and is what cards/chat read. The worker writes both.
- Auth helpers: `requireAuth()` (server components, returns `User` or redirects), `getCurrentUser()`, `requireAuthApi(ownerId)` (route handlers) from `frontend/lib/auth.ts`. URL signing: `signAssetUrl(s3Key)` from `frontend/lib/cdn.ts`; the same-origin media proxy is `/api/media?k=<s3Key>`.
- Prisma singleton: `import { prisma } from "@buttercupp/database"`. Never `new PrismaClient()` (hard repo rule).
- Local infra: `docker-compose.yml` already defines `redis` and a `worker` service; the worker connects with `REDIS_URL=redis://redis:6379` (compose) / `redis://localhost:6379` (host).

## Context to paste into Cursor
```
You are implementing Phase 31 of ButterCupp (see Plans/cursor-prompt/31-your-companions-and-worker-ops.md,
plus Phases 07, 09, 17, 28; PRD §5.6, §5.7, §11).

Two deliverables:

A) "YOUR COMPANIONS" — a new primary-nav section that lists the companions the
   signed-in user CREATED (characters they own), matching the existing dark
   app-shell design language. Ownership ALREADY EXISTS as Character.ownerUserId.
   DO NOT add a Companion table, a new column, or any migration. This is a
   read view + two actions (Chat, Regenerate images) over routes that already
   exist and already enforce ownership.

B) BULLMQ MEDIA-WORKER OPERATIONAL FIX — the create pipeline is CORRECT (Phase 28
   already routes generation through the BullMQ queue and the worker dual-writes
   MediaAsset + CharacterMedia). The bug is that the WORKER PROCESS was not
   running locally (no REDIS_URL / worker not started). Fix = make it runnable
   and OBSERVABLE, and make the UI degrade gracefully. DO NOT rewrite the
   pipeline, DO NOT add a second/inline image path, DO NOT change the
   MediaAsset/CharacterMedia split.

FROZEN — do not touch: the Prisma schema, the Prisma client/engine wiring
(packages/database/src/client.ts, resolveEnginePathForLambda, the lazy Proxy,
binaryTargets), next.config.ts serverExternalPackages, amplify.yml, the 18
Amplify env vars, instrumentation.ts. The production stack is known-good; this
phase is additive frontend + local/observability + docs only.

Prisma singleton: import { prisma } from "@buttercupp/database". Never new PrismaClient().
Zod on every input at the trust boundary. TypeScript strict, no `any`. No em dashes.
Local-only work: never provision cloud, never write a hosted DB/S3/secret, never
scale an ECS service, never deploy. STOP and ask before any prod-touching action.
```

## Concrete paths
- Nav data: `frontend/components/app-shell/nav-items.ts` (add `companions` to the `NavIcon` union + a nav entry).
- Nav icons: `frontend/components/app-shell/SideNav.tsx` (add `companions` to the `ICONS` map) and `frontend/components/app-shell/MobileNav.tsx` (same icon map, if it maintains its own).
- New route: `frontend/app/(protected)/companions/page.tsx` (server component, `force-dynamic`).
- New data lib: `frontend/lib/companions.ts` (`listCompanions(userId)`).
- New client component(s): `frontend/components/companions/CompanionCard.tsx` and, if a card needs polling, a small `"use client"` status hook. Reuse the visual language from the Discover cards (`frontend/app/(protected)/discover/*` and its card component) and `frontend/lib/character-media.ts` helpers.
- Existing routes reused as-is (owner-checked already): `POST /api/characters/[id]/generate-images` (regenerate), `GET /api/characters/[id]/gallery` (status/images), `/chat/[id]` (chat).
- Worker + queue (read, do not re-architect): `backend/src/worker.ts`, `backend/src/queue/{media-worker.ts,media-queue.ts,connection.ts}`, `backend/src/media/asset.ts`.
- Health/observability: `backend/src/http/*` (wherever the API `/health` lives; add queue-depth + redis-connectivity fields).
- Local infra: `docker-compose.yml`, `backend/package.json` (`worker` / `start:worker` scripts).
- Prod diagnosis (READ-ONLY, documented not executed): `infra/ecs/task-worker.json`, `infra/env-catalog.md`, log group `/ecs/buttercupp-worker`.

## Build steps
Do these in order. Name files exactly as below.

### Part A: "Your Companions"

1. **Nav entry + icon.**
   - In `frontend/components/app-shell/nav-items.ts`: extend the union to `export type NavIcon = "chats" | "discover" | "reels" | "create" | "billing" | "settings" | "companions";` and add an entry to `APP_NAV`. Place it directly after Create: `{ href: "/companions", label: "Your Companions", icon: "companions", testid: "nav-companions" }`.
   - In `frontend/components/app-shell/SideNav.tsx`: import a lucide icon that is NOT already used (chats=MessageCircle, discover=Compass, reels=Clapperboard, create=Sparkles, billing=Gem, settings=Settings). Use `Users` (or `Heart`). Add `companions: Users,` to the `ICONS` record. Do the same in `MobileNav.tsx` if it keeps its own icon map. No other nav change is needed; active state + styling are derived automatically.

2. **Data lib: `frontend/lib/companions.ts`.**
   - Export `listCompanions(userId: string)` returning an array of card view-models:
     ```
     type CompanionCardVM = {
       id: string;
       name: string;
       avatarUrl: string | null;      // signed primary CharacterMedia (isDisplay -> isPrimary -> first)
       contentRating: ContentRating;
       visibility: Visibility;
       moderationStatus: ModerationStatus;
       createdAt: string;
       gen: { queued: number; processing: number; ready: number; failed: number; primaryReady: boolean };
     };
     ```
   - Query in ONE round-trip where practical: `prisma.character.findMany({ where: { ownerUserId: userId }, orderBy: { createdAt: "desc" }, include: { media: { where: { kind: "image", hidden: false }, orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }] } } })`. Pick the primary via the SAME ordering the rest of the app uses (`frontend/lib/character-media.ts`); do not invent new image-selection logic. Sign the chosen key with `signAssetUrl` or emit the `/api/media?k=` proxy URL (match whatever cards elsewhere use).
   - For `gen` status, aggregate `MediaAsset` counts per character for this owner: `prisma.mediaAsset.groupBy({ by: ["characterId","status"], where: { userId, characterId: { in: ids }, kind: "image" }, _count: true })`. `primaryReady = boolean(avatarUrl)`. Keep it to a single grouped query, not N queries.
   - ownerUserId scoping is the security boundary; never accept a userId from the client (see Security checks).

3. **Page: `frontend/app/(protected)/companions/page.tsx`.**
   - Server component, `export const dynamic = "force-dynamic";`. `const user = await requireAuth();` then `const companions = await listCompanions(user.id);`.
   - Render a responsive card grid in the existing design language (reuse Discover's grid/card spacing, `hsl(var(--buttercupp-*))` tokens, rounded surfaces). Header: "Your Companions" + a subtitle count. Empty state when `companions.length === 0`: a friendly panel with a primary CTA linking to `/create` ("Create your first companion").
   - Each card = `CompanionCard` (below).

4. **Client component: `frontend/components/companions/CompanionCard.tsx` (`"use client"`).**
   - Props: one `CompanionCardVM`. Renders avatar (fallback to initial when `avatarUrl` null), name, a small badge derived from `gen`:
     - `failed > 0` -> "Some images failed" (amber) + Retry.
     - `queued + processing > 0` -> "Generating..." (animated) .
     - `primaryReady` -> no badge (or a subtle "Ready").
     - none ready and none pending -> "No images yet" + a Generate button.
   - Actions: **Chat** -> `Link` to `/chat/${id}`. **Regenerate images** -> `POST /api/characters/${id}/generate-images` (fire-and-forget), then begin polling.
   - Polling: while `queued + processing > 0` (or right after a regenerate), poll `GET /api/characters/${id}/gallery?limit=1` (or the status summary if you add one in step 5) every ~2.5s, up to a cap (e.g. 90s), to flip the badge to Ready and swap in the avatar. Stop polling when nothing is pending. Debounce so multiple cards do not hammer the API.
   - If the regenerate POST returns `{ status: "unavailable" }` (Redis/backend down), show an inline "Image service is temporarily unavailable, try again shortly" with the Retry affordance. Do NOT block the card.

5. **(Optional, only if the gallery GET is not enough) status summary.**
   - If per-card polling of the gallery route is too heavy, add `GET /api/characters/[id]/generation-status` (owner-only, `requireAuth` + `character.ownerUserId === user.id`) returning `{ queued, processing, ready, failed, primaryReady }` from a single `MediaAsset` groupBy. Prefer reusing the existing gallery route first; add this only if you measurably need it.

### Part B: BullMQ media-worker operational fix + hardening

6. **Local runnability (document + verify, minimal code).**
   - Confirm `docker-compose.yml` `redis` + `worker` services are correct and that the worker service sets `REDIS_URL`, `DATABASE_URL`, and (for real images) an image-provider var (`POPPY_JUGGERNAUT_URL` for local ComfyUI, or `FAL_KEY`/`REPLICATE_API_TOKEN`). Do not change prod values.
   - The canonical local run (put in the phase writeup + a short note near the worker script comment): `docker compose up -d redis` then `REDIS_URL=redis://localhost:6379 npm run worker -w backend` (add `POPPY_JUGGERNAUT_URL=http://127.0.0.1:8188` for real generation). Without a running worker + reachable Redis, enqueued jobs sit unprocessed and no image ever appears — this is the exact local symptom being fixed.
   - Verify `backend/src/worker.ts` behavior: if `startMediaWorker()` returns null because `REDIS_URL` is unset, it currently exits code 1. Keep that (fail-fast is correct for a dedicated worker container), but make the log line unmistakable (`"FATAL: REDIS_URL not set; media worker cannot start"`), so ECS logs point straight at the cause.

7. **Observability: make a dead/stalled worker visible (code, local + prod-safe).**
   - Extend the API `/health` (or add `/health/queue`) to report, without failing the endpoint: `redisConfigured: boolean`, `redisReachable: boolean` (a short PING with a timeout), and queue depth `{ waiting, active, delayed, failed }` from BullMQ `queue.getJobCounts()`. Guard everything so a Redis outage returns a JSON body with `redisReachable:false` rather than a 500.
   - Add a worker heartbeat: on each processed job (and every N seconds via a timer) `logInfo("media-worker", "heartbeat", { processed, concurrency })`, so `/ecs/buttercupp-worker` shows liveness. This is the cheapest prod signal that the worker is actually consuming.
   - Do NOT add external alerting/paging infra in this phase; logs + `/health` are the deliverable.

8. **UI resilience (ties Part A to Part B).**
   - Wherever creation/regeneration is triggered (the wizard finish screen from Phase 28 AND the new Companion card), treat `{ status: "unavailable" }` as a soft, retryable state with a clear message, never a hard error and never a blocked navigation. The character remains usable in chat; images fill in when the worker is back.

9. **Prod diagnosis runbook (WRITE IT INTO THIS DOC; do NOT execute against AWS).**
   Add a copy-paste, READ-ONLY runbook (also mirror it in `infra/env-catalog.md` if a runbook section fits) to pinpoint a prod worker outage. All commands below are read-only:
   ```
   # 1. Is the worker service even up? (desiredCount vs runningCount)
   aws ecs describe-services --cluster buttercupp-prod --services buttercupp-worker \
     --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,status:status}'

   # 2. Why did the last task stop? (crash-loop reason)
   aws ecs list-tasks --cluster buttercupp-prod --service-name buttercupp-worker \
     --desired-status STOPPED --query 'taskArns' --output text
   aws ecs describe-tasks --cluster buttercupp-prod --tasks <taskArn> \
     --query 'tasks[0].{stopped:stoppedReason,containers:containers[].{name:name,reason:reason,exitCode:exitCode}}'

   # 3. Worker logs: look for REDIS_URL fatal, bullmq require failure, DB/S3/provider errors
   aws logs tail /ecs/buttercupp-worker --since 1h --format short

   # 4. Task-def env audit: PROCESS_ROLE=worker, REDIS_URL secret present,
   #    DATABASE_URL present, an image-provider key present, S3_BUCKET present
   aws ecs describe-task-definition --task-definition buttercupp-worker \
     --query 'taskDefinition.containerDefinitions[0].{env:environment,secrets:secrets[].name,command:command}'
   ```
   **Ranked likely causes** (document each with its fix, and mark every fix as "requires explicit per-action human approval"):
   1. `desiredCount = 0` -> no worker consuming the queue -> jobs pile up in Redis forever. Fix: scale service to >=1 (prod-touching: ASK first).
   2. `REDIS_URL` missing/unreachable in the worker task -> `startMediaWorker()` returns null -> `worker.ts` exits code 1 -> ECS crash-loop. Fix: ensure the `REDIS_URL` secret/env is on the worker task (prod-touching: ASK first).
   3. Missing image-provider key (`FAL_KEY`/`REPLICATE_API_TOKEN`/`POPPY_*`) -> provider chain exhausts -> every job fails after retries (tokens refunded, `media.error` pushed). Fix: provision the provider secret (prod-touching: ASK first).
   4. `PROCESS_ROLE` not `worker` on the task -> the image entrypoint runs `node dist/index.js` (API) instead of the worker -> queue never drained. Fix: correct the task-def env (prod-touching: ASK first).
   5. `DATABASE_URL` / RDS unreachable or S3 creds missing -> jobs fail at lifecycle/upload. Fix: verify secrets (prod-touching: ASK first).
   - The runbook only DIAGNOSES. Any remediation (scaling, secret write, task-def revision, redeploy) is a separate, explicitly-approved action.

## Test instructions
```
# Typecheck + lint + em-dash scan (whole repo)
npm run typecheck
npm run check:no-em-dash

# Vitest (frontend): companions data lib scoping + card status derivation
npm run test -w frontend -- companions

# Vitest (backend): /health queue counts + worker heartbeat (Redis mocked)
npm run test -w backend -- health
npm run test -w backend -- worker

# Playwright E2E (worker/image backend stubbed)
npm run test:e2e -w frontend -- companions
```
Vitest cases:
- **companions scoping** (`frontend/lib/__tests__/companions.test.ts`): `listCompanions(userA)` returns ONLY characters with `ownerUserId === userA`; never returns system personas (`ownerUserId null`) or another user's characters. Avatar selection uses the shared `isDisplay -> isPrimary -> sort` ordering. `gen` counts map from `MediaAsset` group-by; `primaryReady` reflects a signable primary.
- **card status derivation** (unit): given `gen` count combinations, the badge resolves correctly (failed -> retry; pending -> generating; ready -> none/ready; empty -> generate).
- **health queue** (`backend`): `/health` returns `redisConfigured/redisReachable` + job counts; when Redis is unreachable it returns 200 with `redisReachable:false` (never 500).

Playwright E2E (`frontend/e2e/companions.spec.ts`), worker/provider STUBBED (mark ready via the stub, no GPU):
- An authed user who owns >=1 character sees "Your Companions" in the sidenav; clicking it lists exactly their companions (seed a second user's character and assert it is absent).
- Empty-state user sees the "Create your first companion" CTA linking to `/create`.
- A card shows "Generating..." then flips to Ready and shows the avatar as the stubbed worker marks the `MediaAsset` ready; **Chat** navigates to `/chat/[id]`.
- With the enqueue route forced to `{ status: "unavailable" }`, **Regenerate images** shows the soft retry message and does NOT block or error the page.

MANUAL (real end-to-end, local):
```
# 1. Infra up
docker compose up -d redis           # (+ minio if your local S3 target is MinIO)
# 2. Worker up (this is the step that was missing)
POPPY_JUGGERNAUT_URL=http://127.0.0.1:8188 REDIS_URL=redis://localhost:6379 npm run worker -w backend
# 3. App up
npm run dev
# 4. Create a companion via /create -> Finish. Watch worker logs show job start -> ready.
# 5. Open "Your Companions": the new companion appears, status flips to Ready, avatar shows.
# 6. Click Regenerate images -> new jobs enqueue -> status cycles -> new images.
# 7. Kill the worker, regenerate again -> UI shows "temporarily unavailable" + retry (no crash).
# 8. Confirm curl localhost:<api>/health shows redisReachable + queue counts.
```

## Sanity checklist
- [ ] "Your Companions" appears in the sidenav (desktop + mobile) with a distinct icon, correct active-highlight, and routes to `/companions`.
- [ ] `/companions` lists ONLY the signed-in user's owned characters (`ownerUserId`), newest first, with avatar + name; system personas and other users' characters never appear.
- [ ] Empty state shows a Create CTA to `/create`.
- [ ] Each card shows a truthful generation status (generating / ready / failed / none) and, when generating, polls and flips to Ready with the avatar appearing.
- [ ] Chat action opens `/chat/[id]`; Regenerate action re-enqueues via the EXISTING `generate-images` route (no new pipeline).
- [ ] With a running local Redis + `npm run worker`, a newly created companion gets real images end-to-end (worker logs show job start -> ready; `MediaAsset` + `CharacterMedia` both written by the Phase-28 dual-write).
- [ ] With the worker/Redis down, the UI shows a soft, retryable "unavailable" state and never blocks or 500s.
- [ ] `/health` reports `redisConfigured`, `redisReachable`, and queue depth; the worker logs a heartbeat.
- [ ] NO Prisma schema change, NO migration, NO new column/table; `git diff` on `packages/database` and `next.config.ts`/`amplify.yml`/env wiring is empty.
- [ ] `npm run typecheck` and `npm run check:no-em-dash` pass.

## Security checklist
- [ ] **Ownership is server-enforced.** `listCompanions` filters strictly by `ownerUserId = requireAuth().id`. The client never supplies a userId; there is no query param that can widen the set.
- [ ] **No IDOR on actions.** Chat, Regenerate, and any status route resolve the character server-side and reject when `character.ownerUserId !== user.id` (403). The existing `generate-images` and `gallery` routes already do this; do not add a new route that skips the check.
- [ ] **Input validation.** Every new route handler validates params with `assertSafeId` and any body with Zod at the trust boundary; reject unknown shapes.
- [ ] **No signed-URL leakage.** Avatars are signed at read time via `signAssetUrl` / the `/api/media` proxy; never store or return a pre-signed URL in a cache, and never expose another user's `s3Key`.
- [ ] **No secret exposure.** `/health` reports booleans/counts only (`redisConfigured`, `redisReachable`) — never the `REDIS_URL`, connection string, or any credential. Do not log secret values in the heartbeat or diagnosis output.
- [ ] **Auth on `/health` queue detail.** If queue counts could aid an attacker, gate the detailed `/health/queue` behind an internal/authenticated path; keep the plain liveness `/health` unauthenticated but secret-free.
- [ ] **Rate/pressure safety.** Card polling is debounced and capped (bounded duration, backs off, stops when nothing is pending) so many companions cannot self-DoS the API. Regenerate is idempotent-safe (re-enqueue produces new variants, not corruption).
- [ ] **Content gating preserved.** Companions honor existing `contentRating` / age-gate rules; do not surface mature media to an unverified viewer through the new cards.
- [ ] **Prod diagnosis is read-only.** The runbook uses only `describe-*` / `logs tail` calls. No command in this phase mutates AWS state.

## Done criteria
- "Your Companions" is a first-class, owner-scoped section that matches the app-shell design language, lists the user's companions with live image status, and offers Chat + Regenerate, all additive with zero schema/prod-wiring change.
- The BullMQ worker runs cleanly locally with the documented command; a newly created companion gets real images end-to-end; a dead worker is now VISIBLE via `/health` + heartbeat instead of silent; and the UI degrades gracefully when the queue is unavailable.
- A complete, read-only prod diagnosis runbook exists with ranked causes and their (approval-gated) fixes for the `buttercupp-worker` ECS service.
- Vitest (companions scoping, card status, health) and the Playwright companions spec pass (or cleanly skip without DB/Redis). `typecheck` + `check:no-em-dash` green. Zero regression to the Phase-28 create pipeline, the queue/worker, or the token ledger.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret write (REDIS_URL / FAL / REPLICATE / POPPY / S3 / CloudFront into SSM/Secrets Manager), ECS service scaling or task-def revision, Amplify/ECS deploy, or any change to the frozen prod wiring (Prisma engine/client, `next.config.ts`, `amplify.yml`, the 18 Amplify env vars). Each requires an explicit, fresh, per-action human approval, and approval for one action never carries to the next. Local-only work proceeds without it: file edits, `prisma migrate dev` against a LOCAL DB you booted (not needed here anyway), local Redis/MinIO, local ComfyUI on `127.0.0.1:8188`, `npm run worker`, local dev server, Vitest, Playwright, and the READ-ONLY AWS `describe-*`/`logs tail` diagnosis commands.
