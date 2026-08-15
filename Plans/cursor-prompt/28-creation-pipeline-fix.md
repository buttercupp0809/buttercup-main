# Phase 28: Fix the Create-a-Character Pipeline

## Goal
Repair and complete the create-a-character pipeline so a newly created persona reliably ends up with real, character-consistent images that are visible in chat and in the per-character gallery, and so a creator can EDIT a persona (bumping its version) after the fact. The wizard UI (`create/style` -> `identity` -> `appearance` -> `personality` -> `publish`) and the atomic create transaction in `POST /api/characters` already work. The break is downstream of create: image generation is fired from the wizard as a detached Python subprocess (`generate-images` -> `persona_pipeline.py`) that no-ops when `COMFYUI_HOST` is unset, does NOT go through the Phase-07 BullMQ media queue, writes only `CharacterMedia` rows (never `MediaAsset`), and never reports status back to the UI, while the gallery route reads `MediaAsset`. The result: newly created characters get no images (or images the gallery cannot see), rows never reach a `ready` state anyone observes, and the creator has no signal that anything happened.

This phase: (1) audits and documents the full pipeline end-to-end and pins every broken/stubbed link; (2) routes creation-time image generation through the SAME Phase-07 BullMQ queue + Phase-09 `imageHandler` that chat already uses (self-hosted ComfyUI/SDXL primary for dev, Fal/Replicate fallback), replacing the detached-subprocess path; (3) makes the worker write BOTH the `MediaAsset` lifecycle row AND a canonical `CharacterMedia` row with correct `isPrimary`/`sort` flags (coordinating the free-display asset), transitioning `queued -> processing -> ready` with signed S3 URLs; (4) adds a character EDIT/update flow that drives the existing `PATCH /api/characters/:id`; (5) fixes the create-time versioning so the first version is created correctly and edits reliably bump `versionNo`; (6) surfaces generation status (pending/generating/ready/failed) in the UI. Local/dev generation only; no cloud provisioning.

Reference: Phase 06 (creation wizard), Phase 07 (media queue + worker + S3), Phase 09 (image gen + character consistency), Phase 26 (free-display asset) for the `isPrimary`/free-display coordination, PRD §5.6 (image/selfie generation), §5.7 (wizard), §5.2 (character versioning), §11 (media pipeline).

## Prerequisites
- Phase 06 green: 5-step wizard (`frontend/app/(protected)/create/{context.tsx,steps.ts,WizardShell.tsx}` + step pages), `buildCharacterSystemPrompt` (`frontend/lib/character-snapshot.ts`), `POST /api/characters` (atomic `AppearanceSheet` + `VoiceProfile` + `Character` + `CharacterVersion`, repoints `currentVersionId`), `PATCH /api/characters/:id` (new immutable version), `POST /api/characters/:id/publish`.
- Phase 07 green: `backend/src/queue/{media-queue.ts,media-worker.ts,connection.ts,ws-notify.ts}`, `backend/src/media/{asset.ts,token-ledger.ts,storage.ts}`, `MediaAsset` lifecycle (`queued -> processing -> ready | failed`), `enqueueMediaJob`, `notifyMediaReady`. Local Redis (`REDIS_URL=redis://localhost:6379`) and a local S3 target (MinIO/LocalStack via `S3_ENDPOINT`).
- Phase 09 green: `backend/src/media/handlers/image.ts` (`imageHandler`), `backend/src/media/image/{prompt.ts,providers.ts,constants.ts,safety.ts,convert.ts}`, provider chain `generateWithComfyUI[Consistent] -> Fal -> Replicate` in `providers.ts`, `poppyConfigured()` / `resolvePoppyBaseUrl()` in `backend/src/inference/poppyEndpoint.ts`.
- Phase 26 green: the free-display persona asset convention (the primary/free image every character carries). This phase must set `CharacterMedia.isPrimary` to designate exactly that asset.
- `signAssetUrl` in `frontend/lib/cdn.ts` (gallery URL signing); `backend/src/media/storage.ts` `getSignedUrl`.
- Prisma singleton: `import { prisma } from "@buttercupp/database"`. Never `new PrismaClient()`.

## Pipeline audit
Trace the current flow and the exact break at each hop. Reproduce this in the phase writeup, then fix per the build steps.

1. **Wizard draft -> submit.** `create/context.tsx` holds the draft in React state + `localStorage` (`CHARACTER_DRAFT_STORAGE_KEY`), validated per step by `steps.ts::validateStep`. `submit()` POSTs the draft to `/api/characters`, then (if public) POSTs `/publish`, then fire-and-forget POSTs `/api/characters/:id/generate-images`, then clears the draft. WORKS up to the create call.

2. **`POST /api/characters`.** Validates `createCharacterInputSchema`, `requireAgeVerified`, re-checks age for mature, then one `prisma.$transaction` creates `AppearanceSheet` + `VoiceProfile` + `Character` (`visibility: private`, `moderationStatus: pending`) + `CharacterVersion` and repoints `currentVersionId`. WORKS. **Stubbed link:** `versionNo` is hardcoded to `1` (fine for a fresh character, but the create path has no interaction with the versioning helper used by edits, so the two paths can drift). No image generation is enqueued here.

3. **`POST /api/characters/:id/generate-images` (BROKEN CORE).** Loads the character + `currentVersion.appearanceSheet`, builds 4 rule-based prompts + a negative prompt, then:
   - If `process.env.COMFYUI_HOST` is unset it returns `{ status: "queued", message: "GPU not configured; generation skipped." }` and does NOTHING. **This is the primary break in dev:** no queue job, no `MediaAsset`, no image.
   - If set, it `spawn`s a DETACHED Python child (`Plans/inference-aws/persona_pipeline.py`) with `stdio: "ignore"`, passing an API token + `API_BASE`. The child generates images and POSTs each back to `POST /api/characters/:id/gallery` with `{ url: s3Key, kind: "image", isPrimary }` to create `CharacterMedia` rows. **Broken links here:**
     - It bypasses the Phase-07 BullMQ queue and the Phase-09 `imageHandler` entirely, so it does not benefit from retry/backoff, token debit/refund, `media.ready` WS push, or the tested provider fallback chain. It is a second, divergent image path.
     - It never creates a `MediaAsset` row, so status is untrackable and the gallery cannot show it (see step 5).
     - Detached + `stdio: "ignore"` means failures are invisible; the route returns `generating` regardless of outcome.
     - `isPrimary` is decided inside Python (`first_saved` heuristic), not coordinated with the Phase-26 free-display asset.

4. **The two-table split (ROOT-CAUSE MISMATCH).** There are two media tables:
   - `MediaAsset` (queue lifecycle: `status`, `s3Key`, `jobId`, `kind`) is what the Phase-07 worker + `GET /api/characters/:id/gallery` read.
   - `CharacterMedia` (canonical persona store: `url`, `isPrimary`, `sort`, `kind`) is what cards, reels, chat reference-face lookup (`backend/src/chat/image-turn.ts`), and the persona pipeline write.
   The chat image-turn writes BOTH tables in sync; the create/`generate-images` path writes ONLY `CharacterMedia`; the gallery GET reads ONLY `MediaAsset`. So a created character can have `CharacterMedia` rows the gallery never lists, or (in dev) no rows at all. **The fix must make one worker write both, keyed correctly.**

5. **`GET /api/characters/:id/gallery`.** Reads `MediaAsset` where `status: ready`, signs each `s3Key` via `signAssetUrl`, paginates by cursor. Correct in isolation, but starved because the create path never populates `MediaAsset`.

6. **`POST /api/characters/:id/gallery`.** The persona pipeline callback: Bearer-token auth, owner check, writes a `CharacterMedia` row (flips prior `isPrimary` off when `isPrimary` is set). This is the ONLY writer of create-time images today, and it writes the wrong table for the gallery reader.

7. **Chat visibility.** `backend/src/chat/image-turn.ts` loads the reference face from `CharacterMedia.url` (`isPrimary`/first) and, on a chat-time selfie, writes both a `MediaAsset` and a `CharacterMedia` row. So chat CAN show images IF a `CharacterMedia` primary exists. A freshly created character with no primary image degrades the chat reference face.

8. **Status UI.** `submit()` fires generation fire-and-forget and immediately routes away. Nothing polls `GET /api/characters/:id/gallery` or subscribes to `media.ready`, so the creator never sees pending/ready. **Missing link.**

9. **Edit flow.** `PATCH /api/characters/:id` is IMPLEMENTED (owner-only, merges patch onto the current version, `nextVersionNo = max(versionNo) + 1`, new immutable `AppearanceSheet` + `VoiceProfile` + `CharacterVersion`, repoints `currentVersionId`). **Missing link:** there is NO wizard UI or entry point that drives PATCH, so edits are unreachable and appearance edits never trigger regeneration.

Broken/stubbed links summary: (a) `generate-images` no-ops in dev and bypasses the queue; (b) `MediaAsset` vs `CharacterMedia` are written by different paths, gallery reads the one the create path never fills; (c) no status surfaced to the UI; (d) edit is server-only, no UI, no regenerate-on-appearance-change; (e) create-time versioning is a hardcoded literal detached from the edit path's version helper.

## Context to paste into Cursor
```
You are implementing Phase 28 of ButterCupp (see Plans/cursor-prompt/28-creation-pipeline-fix.md,
plus Phases 06, 07, 09, 26; PRD §5.6, §5.7, §5.2, §11).

FIX the create-a-character pipeline. The wizard UI and the atomic create transaction in
POST /api/characters already work. Do NOT rewrite the wizard, the create transaction, or the
Phase-07 queue/worker/token/S3 machinery. This is a repair + wiring + completion phase.

Chosen image backend for dev: SELF-HOSTED ComfyUI/SDXL via the EXISTING Phase-09 provider
chain (backend/src/media/image/providers.ts: generateWithComfyUI -> Fal -> Replicate). ComfyUI
is resolved by poppyConfigured()/resolvePoppyBaseUrl() (POPPY_JUGGERNAUT_URL or the router).
The sibling repo at /Users/kshitijpratap/Documents/Projects/ComfyUI is the local backend; point
POPPY_JUGGERNAUT_URL at its http://127.0.0.1:8188 for dev. DO NOT add a second image path.

Targets:
1. Route creation-time image generation through enqueueMediaJob (kind: "image") on the SAME
   Phase-07 BullMQ queue + Phase-09 imageHandler. Delete/retire the detached persona_pipeline.py
   subprocess path in generate-images. One pipeline, not two.
2. The media worker (or a small post-ready step it calls) must, on a create-time image job,
   write BOTH: the MediaAsset lifecycle row (already done) AND a canonical CharacterMedia row
   (url = signed/stored key, kind: "image", isPrimary/sort set). Gallery reads MediaAsset; chat
   + cards read CharacterMedia. Keep them in sync exactly as chat/image-turn.ts already does.
3. isPrimary: the FIRST ready create-time image for a character with no primary becomes the
   free-display / primary asset (coordinate with Phase 26). Flip any prior primary off in one tx.
4. Add an EDIT flow (UI) that drives the existing PATCH /api/characters/:id and, when appearance
   changed, re-enqueues generation for the new version.
5. Fix versioning so create and edit share ONE version-number source of truth; edits reliably
   bump versionNo (immutable prior versions).
6. Surface generation status in the wizard finish screen (pending/generating/ready/failed) by
   polling GET /api/characters/:id/gallery (or subscribing to media.ready).

Prisma singleton: import { prisma } from "@buttercupp/database". Never new PrismaClient().
Zod on every create/edit mutation. TypeScript strict. No em dashes. Local/dev only: never
provision cloud, never write a hosted DB/S3, never deploy. Stop and ask before any such action.
```

Concrete paths:
- Enqueue + status route: `frontend/app/api/characters/[id]/generate-images/route.ts` (rewrite to enqueue), `frontend/app/api/characters/[id]/gallery/route.ts` (GET status).
- Queue/worker: `backend/src/queue/media-queue.ts`, `backend/src/queue/media-worker.ts`, `backend/src/media/handlers/image.ts`, `backend/src/media/asset.ts`.
- Canonical media write: reuse the pattern in `backend/src/chat/image-turn.ts` (writes both `MediaAsset` + `CharacterMedia`).
- Providers: `backend/src/media/image/providers.ts` (ComfyUI/Fal/Replicate, no changes to the chain).
- Create/edit: `frontend/app/api/characters/route.ts`, `frontend/app/api/characters/[id]/route.ts`.
- Wizard: `frontend/app/(protected)/create/context.tsx`, `frontend/app/(protected)/create/WizardShell.tsx`, `frontend/app/(protected)/create/publish/page.tsx`.
- Chosen backend: `/Users/kshitijpratap/Documents/Projects/ComfyUI` (local, `http://127.0.0.1:8188`) via `POPPY_JUGGERNAUT_URL`.

## Build steps
Do these in order. Name files exactly as below.

1. **Shared: creation-image job payload + count.** In `packages/shared/src/media.ts` (or `character-create.ts`) add a small typed payload shape for a create-time image job: `{ source: "creation"; characterId; characterVersionId; variant: number; userRequest?: string }` reusing the existing `MediaJobData.payload` opaque slot. Add a `CREATION_IMAGE_COUNT` constant (default 4, matching the current 4-prompt behavior). Re-export from `packages/shared/src/index.ts`. Do NOT change `MediaKind`, `MEDIA_QUEUE_NAME`, or `MediaJobData`'s outer shape.

2. **Enqueue creation images (replace the subprocess): `frontend/app/api/characters/[id]/generate-images/route.ts`.**
   - Keep `POST`, `requireAuth`, owner check, the character + `currentVersion.appearanceSheet` load.
   - DELETE the `spawn`/`persona_pipeline.py`/`COMFYUI_HOST` branch entirely. No child process.
   - For `variant` in `0..CREATION_IMAGE_COUNT-1`: `createQueuedAsset({ userId, characterId, kind: "image", meta: { source: "creation", variant, characterVersionId } })` then `enqueueMediaJob({ mediaAssetId, userId, characterId, conversationId: null, kind: "image", tokenCost: 0, payload: { source: "creation", characterVersionId, variant, userRequest: "" } })`. Creation-time generation is free (`tokenCost: 0`), unlike chat selfies; document this so the worker's debit is a no-op for zero cost (or short-circuit debit when `tokenCost === 0`).
   - Return `{ status: "queued", assetIds: string[] }` (the `mediaAssetId`s the UI polls). If `REDIS_URL` is unset, fall back to running `processJob` inline OR return `{ status: "unavailable" }` with a clear message (keep the wizard non-blocking either way; document which you chose).

3. **Worker writes CharacterMedia + flags: `backend/src/queue/media-worker.ts` (+ helper in `backend/src/media/asset.ts`).**
   - After `markReady(mediaAssetId, s3Key, meta)` for an image job whose `meta.source === "creation"` (or whenever `characterId` is set and no primary exists), also upsert a canonical `CharacterMedia` row: `{ characterId, kind: "image", url: <stored key or signed-at-read>, sort: variant, isPrimary: <first-ready-for-character> }`. Mirror EXACTLY the dual-write already in `backend/src/chat/image-turn.ts` so cards/chat/gallery stay consistent. Store the same value shape in `CharacterMedia.url` that `image-turn.ts` stores (raw key that `signAssetUrl` can later sign, not a pre-signed expiring URL).
   - `isPrimary` rule: in one `prisma.$transaction`, if the character has no `CharacterMedia` with `isPrimary: true`, set this row `isPrimary: true` (and flip any stale primary off). This is the Phase-26 free-display asset. Use a conditional guard so two concurrent create-image jobs cannot both claim primary (e.g. `updateMany where isPrimary true first`, or an `INSERT ... WHERE NOT EXISTS` shape); document the race handling.
   - Keep the existing `MediaAsset` transitions (`processing -> ready | failed`), `media.ready` WS push, and metrics untouched. Add a `characterMediaId` to the ready `meta` for observability.

4. **Zero-cost debit path: `backend/src/media/token-ledger.ts` / worker.** Ensure `tokenCost === 0` does not write a spurious ledger row or fail the debit. Either short-circuit `debitTokens` when `delta === 0`, or skip the debit call in the worker for creation jobs. Refund logic must likewise no-op at cost 0. Document that CHAT selfies still debit `IMAGE_TOKEN_COST`; only CREATION images are free.

5. **Gallery status + primary: `frontend/app/api/characters/[id]/gallery/route.ts`.**
   - `GET`: keep returning `ready` `MediaAsset` rows with signed URLs, but ALSO include a lightweight status summary the UI can poll: counts of `queued`/`processing`/`ready`/`failed` for the character (so the finish screen shows progress). Add `?includeStatus=1` or a sibling `GET /api/characters/:id/generation-status` route returning `{ queued, processing, ready, failed, primaryReady: boolean }`. Owner-only.
   - `POST` (the old persona-pipeline callback): retire or gate it. Since generation now runs in-process via the worker, this Bearer-token external callback is no longer the create path. Either remove it or restrict it behind a feature flag and document it as legacy. Do not leave two writers of `CharacterMedia` for the same event.

6. **Create-time versioning single source of truth: `frontend/app/api/characters/route.ts` + a helper.**
   - Extract the version-number logic into a shared helper `nextVersionNo(tx, characterId): Promise<number>` (returns `1` for a brand-new character, `max(versionNo)+1` otherwise) and use it in BOTH `POST /api/characters` (currently hardcoded `versionNo: 1`) and `PATCH /api/characters/:id` (currently inlines the aggregate). This removes the drift risk and makes the first version explicit rather than a literal. Keep the create transaction otherwise identical.

7. **Edit flow UI: `frontend/app/(protected)/create/*` + entry point.**
   - Add an "Edit" entry from the persona detail/owner view that seeds the wizard draft from `GET /api/characters/:id` (populate `context.tsx` draft from the current version) and runs in an edit mode where Finish calls `PATCH /api/characters/:id` instead of `POST /api/characters`. Reuse the existing steps + validation.
   - In `create/context.tsx`, add `mode: "create" | "edit"` and an optional `characterId`; `submit()` branches: create -> `POST`, edit -> `PATCH`. On an edit that changed appearance (traits/stylePrompt/negativePrompt/referenceImageKeys/style), after PATCH succeeds, POST `/api/characters/:id/generate-images` again to regenerate for the NEW version (pass the new `characterVersionId`). If appearance is unchanged, skip regeneration.
   - Keep the localStorage autosave key distinct per mode (do not clobber a create draft with an edit draft), or clear on entry.

8. **Status UI on finish: `frontend/app/(protected)/create/publish/page.tsx` (or a finish screen) + `WizardShell.tsx`.**
   - After `submit()` returns `{ ok: true, id }`, route to a finish/preview state that polls `GET /api/characters/:id/generation-status` every ~2s (or subscribes to `media.ready`) and renders per-image skeletons transitioning `pending -> generating -> ready`, plus a clear `failed`/`retry` state. Show the primary image once `primaryReady`. Provide a "Start chatting" CTA that is enabled immediately (generation is non-blocking) but shows a hint while images are still pending.
   - Do not block navigation on generation; the character is usable in chat as soon as it is created (the reference face fills in as the primary becomes ready).

9. **Retire the subprocess assets.** Remove the now-dead `spawn` import + `persona_pipeline.py` args from `generate-images/route.ts`. Leave `Plans/inference-aws/persona_pipeline.py` on disk (it remains the batch/offline tool) but add a one-line comment in the route noting the in-process worker is now the single create-time path. Do not delete the batch pipeline.

## Test instructions
```
# Vitest (backend): prompt build, version bump, dual media write
npm run test -w backend -- image
npm run test -w backend -- media
npm run test -w backend -- worker

# Vitest (frontend): version helper + edit-mode submit branch
npm run test -w frontend -- characters

# Requires local Redis + local S3 target + local ComfyUI:
docker compose up -d redis minio
POPPY_JUGGERNAUT_URL=http://127.0.0.1:8188 REDIS_URL=redis://localhost:6379 \
  npm run test -w backend -- media

# Playwright E2E (mocked/stubbed image backend)
npm run test:e2e -w frontend -- create-pipeline
```
Vitest cases:
- **creation prompt build** (`backend/src/media/image/__tests__/prompt.test.ts`, extend): a create-time image job builds the deterministic prompt from the `AppearanceSheet` (stylePrompt + traits + `SAFETY_NEGATIVE`); the same sheet yields the same core prompt across variants (only scene/pose varies).
- **version bump** (`frontend` or `backend` unit): `nextVersionNo` returns `1` for a new character and `max+1` for an existing one; a PATCH after create produces `versionNo: 2` and repoints `currentVersionId` without mutating v1 (assert v1 row unchanged).
- **dual media write** (`backend/src/queue/__tests__/media-worker.test.ts` or `media/__tests__`): drive `processJob` with a `source: "creation"` image job and a mock/stub handler; assert the `MediaAsset` reaches `ready` AND a `CharacterMedia` row is created with the right `characterId`/`kind`; the FIRST create-image for a character gets `isPrimary: true`, a second does not; two concurrent jobs never yield two primaries.
- **zero-cost debit** (`backend/src/media/__tests__/token-ledger`): a `tokenCost: 0` job writes no ledger row and does not fail; a chat selfie at `IMAGE_TOKEN_COST` still debits.
- **provider fallback** (existing Phase-09 tests still green): ComfyUI absent/erroring -> Fal -> Replicate; 401 disables provider for the session.

Playwright E2E (`frontend/e2e/create-pipeline.spec.ts`), image backend STUBBED (mock the worker handler or the provider fetch so no GPU is needed):
- An authed, age-verified user completes all 5 wizard steps and hits Finish.
- The finish screen shows pending/generating skeletons, then transitions to `ready` as the stubbed worker marks assets ready.
- `GET /api/characters/:id/generation-status` reports `primaryReady: true`; the primary image renders.
- Opening `/chat/[id]` shows the character with its image (CharacterMedia primary), and the per-character gallery lists the ready images (MediaAsset).
- Editing the character (appearance change) via the edit flow produces `versionNo: 2` and re-enqueues generation for the new version.

MANUAL (real end-to-end, local ComfyUI):
```
# 1. Boot ComfyUI locally (sibling repo)
cd /Users/kshitijpratap/Documents/Projects/ComfyUI && python main.py   # serves :8188
# 2. Boot Redis + MinIO, run the worker + app with envs
POPPY_JUGGERNAUT_URL=http://127.0.0.1:8188 REDIS_URL=redis://localhost:6379 npm run worker -w backend
npm run dev
# 3. Create a character in the wizard -> Finish -> watch pending -> ready
# 4. Confirm: gallery lists images, chat shows the primary, generate 2-3 more
#    and confirm the SAME face/traits (character consistency via InstantID/ref face).
# 5. Edit appearance -> confirm versionNo bumps and new images regenerate.
```

## Sanity checklist
- [ ] A newly created character gets REAL images: the wizard Finish enqueues jobs, the worker runs the Phase-09 `imageHandler` (ComfyUI in dev, Fal/Replicate fallback), and `MediaAsset` rows reach `ready` with valid signed S3 URLs.
- [ ] Every ready create-time image writes BOTH a `MediaAsset` (gallery) AND a `CharacterMedia` (cards/chat) row, in sync, matching the chat `image-turn.ts` dual-write.
- [ ] Exactly one `CharacterMedia` is `isPrimary: true` per character (the free-display asset); concurrent create jobs never produce two primaries.
- [ ] The gallery (`GET /api/characters/:id/gallery`) lists the created images and the chat shows the primary as the character's face.
- [ ] Generation status is visible in the wizard finish screen (pending -> generating -> ready, with a failed/retry state); navigation is never blocked on generation.
- [ ] The detached `persona_pipeline.py` subprocess path is removed from `generate-images`; there is ONE create-time image path (the queue). The batch pipeline file remains on disk.
- [ ] An edit (`PATCH /api/characters/:id`) is reachable from the UI, bumps `versionNo` (immutable prior versions), and re-enqueues generation when appearance changed.
- [ ] Create and edit share one `nextVersionNo` helper; a new character's first version is `1`, an edit is `2`.
- [ ] Creation images are free (`tokenCost: 0`, no ledger row); chat selfies still debit `IMAGE_TOKEN_COST`.

## Done criteria
- The create pipeline is single-path and end-to-end: wizard -> `POST /api/characters` (atomic version create) -> `generate-images` enqueue -> BullMQ worker -> Phase-09 `imageHandler` -> S3 -> `MediaAsset` (ready) + `CharacterMedia` (primary/sort) -> visible in chat and gallery, with status surfaced in the UI.
- Vitest suites (prompt build, version bump, dual media write + isPrimary, zero-cost debit) and the Playwright create-pipeline spec pass (or cleanly skip when no DB/Redis), with the image backend mocked/stubbed.
- Edit flow reachable, versioning correct and immutable, regeneration fires on appearance change.
- Manual local run with ComfyUI produces character-consistent images visible in chat + gallery; zero regression to chat-time selfies, the Phase-07 queue, or the token ledger.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret write (POPPY/FAL/REPLICATE keys, S3/CloudFront creds into SSM/Secrets Manager), Redis/S3 provisioning on AWS, or ECS/Amplify deploy. Each requires an explicit, fresh, per-action human approval. Local-only work proceeds without it: file edits, `prisma migrate dev` against a LOCAL database you booted, local Redis/MinIO, local ComfyUI on `127.0.0.1:8188`, `npm run worker`, local dev server, Vitest, Playwright. Never assume prior approval carries to the next action.
