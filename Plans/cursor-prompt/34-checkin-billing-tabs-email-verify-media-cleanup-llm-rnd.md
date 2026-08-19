# 34 - Active check-in, billing tabs, email verification, persona media backfill, distortion scan, LLM R&D

This prompt covers six features. Implement them in the **build order** below, not
top to bottom. Each feature has: goal, exact files and symbols to touch (verified
against the current tree), acceptance criteria, and tests. Two features (5 and 6
in the list, features 4 and 5 by number) touch the production database and S3 and
are split into a safe local phase plus a gated human-approved prod phase. Read the
Ground rules and the Guardrail block before writing any code.

## Ground rules (read first, do not skip)

- Follow `CLAUDE.md` at the repo root. It wins over anything else.
- Prisma singleton is a hard rule: import `{ prisma }` from `@buttercupp/database`.
  Never `new PrismaClient()` outside `packages/database/src/client.ts`.
- No em dash characters anywhere (code, comments, copy, docs). Use commas,
  periods, or parentheses. `npm run check:no-em-dash` must stay green.
- TypeScript strict everywhere. Validate every trust boundary with `zod`. No `any`
  without a comment explaining why.
- Payments are adult-processor only (`dodo` primary; `stripe` and `paypal` are
  compile-time forbidden). Do not touch payment processors in this prompt.
- After each feature: run typecheck, lint, and that feature's tests before moving
  on. At the end run the full sanity suite in the "Global sanity" block.

## Guardrail block (features 4 and 5, do not violate)

The following are HUMAN actions. The agent must build the code and scripts, run
them against LOCAL only, print a report, and then STOP:

- Any write to the production database (persona `CharacterMedia` / `MediaAsset`
  rows, deletions).
- Any write or delete against a production S3 bucket.
- `prisma migrate deploy` / `db push` against any non-local database.
- `git commit`, `git push`, deploy, Docker push, secret writes.

For features 4 and 5 the agent runs the LOCAL phase (local Postgres, local MinIO
if configured) and produces artifacts (an upload plan, a distortion report). The
PROD phase is listed in "Manual steps" and requires a fresh, explicit human go
for that exact action. Report-first is mandatory for feature 5 deletions.

---

## Build order

1. Feature B (billing tabs) - pure UI, safe, fastest.
2. Feature G (Meta Pixel Lead on signup) - tiny client change, safe.
3. Feature A (active check-in) - app feature, local only.
4. Feature C (email verification) - app feature plus a LOCAL migration.
5. Feature F (LLM R&D doc) - research deliverable, safe.
6. Feature D (persona media backfill) - build script, run LOCAL, STOP for prod.
7. Feature E (distortion scan) - depends on D; run SCAN only, STOP before deletes.

Rationale: ship the safe app features and the research doc first; the two
prod-touching data jobs land last and stop at the approval gate. E strictly
depends on D (E scans what D uploads).

---

## Feature A: Active check-in message when a user opens a chat

### Goal

When a user opens a chat with a character, the character proactively sends a
short, personalized check-in as the first visible message, generated live by the
chat LLM using the character persona plus the user's name and onboarding
preferences. It fires on the first ever open of a conversation AND on reopen after
an idle gap (default 24h) when there is no pending unanswered assistant message.
It must never leave the chat empty: if the LLM chain is unavailable, fall back to
the character's static `greeting` field lightly personalized with the name.

Decisions (locked): generation = live LLM personalized; trigger = every reopen
after a gap; name source = `UserProfile.displayName`, fallback to the email local
part; gap threshold = 24h.

### Current state (verified)

- Chat page (server component): `frontend/app/(protected)/chat/[characterId]/page.tsx`.
  Runs `requireAuth()`, upserts the conversation via `prisma.conversation.upsert`
  on the unique `(userId, characterId)` (around lines 50-58), then loads the last
  50 messages for `initialMessages` (around lines 60-78, ordered `createdAt desc`,
  reversed).
- Conversation POST: `frontend/app/api/conversations/route.ts` (idempotent, around
  lines 45-51, returns `{ id, reused }`).
- No proactive first message exists today. `CharacterVersion.greeting`
  (`packages/database/prisma/schema.prisma` line 251) is stored but unused on open.
- Persona layers for prompts: `backend/src/llm/prompts.ts` (name, personality,
  backstory, behavioralInstructions, relationship state) and
  `backend/src/llm/prompt-fills.ts` (uncensored system fills).
- LLM chain and streaming/non-streaming callers: `backend/src/llm/provider.ts`
  (`callLLM`, provider fallback chain, circuit breaker), `backend/src/chat/engine.ts`
  (`runChatTurn`, `HISTORY_TURNS = 20`, temperature 0.8, maxTokens 350).
- User data: `User.email`; `UserProfile.displayName`, `UserProfile.gender`,
  `UserProfile.preferences` JSON (`vibe`, `interests: string[]`, `companionGoal`),
  schema lines ~165-177. `UserProfile` is optional (null checks required).
- Message model: `packages/database/prisma/schema.prisma` lines ~314-327
  (`role`, `content`, `conversationId`, `createdAt`, `mediaAssetId?`).
- Known constraint: host-only auth cookie can fail to reach the `api.` subdomain
  (see memory `chat-delivery-cross-subdomain-cookie`). Because the check-in is
  produced server-side and read back from the DB by the chat page (not over WS),
  it is not affected by the WS cookie issue, but any server-to-backend HTTP call
  must forward the incoming `buttercupp_auth` cookie.

### Changes

1. **Backend: new check-in turn** in `backend/src/chat/checkin.ts`:
   - Export `async function maybeRunCheckin(input: { conversationId: string; userId: string }): Promise<{ created: boolean; message?: { id: string; role: "assistant"; content: string; createdAt: string } }>`.
   - Load the conversation with its character version, the user, and the user
     profile. Load the most recent message for the conversation.
   - Gap/eligibility rule (create a check-in only when ALL hold):
     - the requesting user owns the conversation;
     - there is no message yet, OR the latest message `createdAt` is older than
       `CHECKIN_GAP_MS` (default 24h) AND the latest message role is `user`
       (do not stack a second unanswered assistant message; if the last message
       is already an assistant message, do nothing).
   - Build a personalization context: `name` = `profile.displayName` or the part
     of `user.email` before `@`; `vibe`, `interests`, `companionGoal` from
     `profile.preferences` when present; relationship state if available.
   - Generate via the existing provider chain (`callLLM` in `provider.ts`) with a
     dedicated system prompt that reuses the persona layers from `prompts.ts` plus
     a short check-in instruction: "You are re-initiating contact. Send ONE warm,
     in-character opening line (2 to 3 short lines, action beats in asterisks)
     that references the user by name and, when natural, one of their stated
     interests or goals. Do not ask more than one question. Never mention being an
     AI." Keep `maxTokens` around 120, temperature around 0.8.
   - Fallback: if the chain throws, the breaker is open, or content is empty, use
     `characterVersion.greeting` with the name interpolated (for example prefix
     "Hey {name}, " when the greeting does not already start with the name). The
     chat must never open empty.
   - Persist: create a `Message` with `role: "assistant"`, `content`,
     `conversationId`; update `Conversation.messageCount` and `lastMessageAt`
     atomically (single `prisma.$transaction`). Idempotency: re-check inside the
     transaction that no assistant message was created concurrently.
   - Add module constant `CHECKIN_GAP_MS = 24 * 60 * 60 * 1000` (env override
     `POPPY_CHECKIN_GAP_MS`).

2. **Backend: HTTP endpoint** in `backend/src/http/chat-checkin.ts` mounted next
   to `chat-stream.ts`:
   - `POST /chat/checkin` with zod body `{ conversationId: string }`.
   - Authenticate via the `buttercupp_auth` JWT cookie exactly as
     `chat-stream.ts` does; resolve `userId` from the token.
   - Call `maybeRunCheckin` and return `{ created, message? }`. Never 500 on a
     generation failure (the fallback path covers it); only 400 on bad body and
     401 on missing/invalid auth.

3. **Frontend: trigger on open** in
   `frontend/app/(protected)/chat/[characterId]/page.tsx`:
   - After the conversation upsert and before loading `initialMessages`, call the
     backend `POST /chat/checkin` server-side, forwarding the incoming request
     cookies (use the same backend base URL and cookie-forwarding pattern the app
     already uses for server-to-backend calls; if none exists, read the backend
     base from the existing env used by the chat transport and forward the
     `cookie` header from `next/headers`). Swallow any error (best effort). Then
     load `initialMessages` as today, so a freshly created check-in is included.
   - Do not add a client round trip; this stays a server-component step.

### Acceptance criteria

- Opening a brand new conversation shows one assistant check-in that includes the
  user's name and reads in character.
- Reopening a conversation whose last message is older than 24h and was from the
  user produces a new check-in; reopening within 24h, or when the last message is
  already an assistant message, produces none (no stacking).
- With the LLM chain forced to fail, the chat still opens with the static greeting
  personalized with the name; no error surfaces to the user.
- The check-in is a persisted `assistant` `Message` and appears in
  `initialMessages` without any WebSocket dependency.
- No base64 or PII beyond first name and stated preferences enters the prompt.

### Tests (backend, mock the LLM and prisma)

Add `backend/src/chat/__tests__/checkin.test.ts`:

- eligible when no messages exist; eligible when last message is `user` and older
  than the gap; NOT eligible within the gap; NOT eligible when last message is
  `assistant`.
- name resolution: `displayName` wins; falls back to email local part when the
  profile or displayName is missing.
- fallback path: when `callLLM` rejects, the persisted content equals the
  personalized `greeting` and `created` is true.
- persistence: exactly one assistant message is created and
  `messageCount`/`lastMessageAt` are updated in a single transaction; a simulated
  concurrent second call does not create a duplicate.

Add `backend/src/http/__tests__/chat-checkin.test.ts`: 401 without cookie, 400 on
bad body, 200 `{ created }` on success.

---

## Feature B: Subscription and Passes tabs on the billing page, hide token packs

### Goal

Restructure the billing page into a tab control with two tabs: "Subscription"
(active by default) showing both subscription tiles, and "Passes" showing the
three duration passes (Daily, Weekly, Monthly). Hide the token packs section for
now (keep the code, do not delete it).

### Current state (verified)

- `frontend/app/(protected)/billing/BillingClient.tsx` renders three sections in
  order: Subscriptions (`sub_monthly`, `sub_yearly`, around lines 246-393,
  `data-testid="subscriptions-section"`), Passes (`daily`, `weekly`, `monthly`,
  around lines 397-535, `data-testid="plan-cards"`), and Token packs via
  `<TokenStore />` (around lines 539-548). Below those are premium benefits and
  reviews.
- Plan data is fetched from the backend (`GET /billing/plans`), not hardcoded;
  `splitPlans()` (around lines 125-131) splits by the `recurring` flag. No backend
  change is needed for this feature.
- There is no shadcn/ui Tabs primitive. UI primitives live in
  `frontend/components/ui/` and follow a CVA + Tailwind + CSS-variable pattern
  (see `button.tsx`, `Modal.tsx`).

### Changes

1. Create `frontend/components/ui/Tabs.tsx`: a small controlled tab component
   following the existing CVA pattern. Accessible (role="tablist", `aria-selected`,
   keyboard left/right). No external dependency.
2. In `BillingClient.tsx`:
   - Add local state `activeTab: "subscription" | "passes"` defaulting to
     `"subscription"`.
   - Render the Tabs above the plan grids. When `subscription` is active, show the
     current Subscriptions section (both tiles). When `passes` is active, show the
     current Passes section (daily, weekly, monthly).
   - Hide the `<TokenStore />` section behind a constant flag
     `const SHOW_TOKEN_PACKS = false;` so it is trivially re-enabled later. Do not
     delete `TokenStore.tsx`.
   - Keep the premium-benefits and reviews sections rendered under the tabs
     regardless of active tab.
   - Preserve all existing `data-testid`s so existing tests keep working; add
     `data-testid="billing-tab-subscription"` and `data-testid="billing-tab-passes"`.

### Acceptance criteria

- On load, the Subscription tab is active and both subscription tiles are visible;
  the three pass tiles are not visible.
- Clicking Passes reveals Daily, Weekly, and Monthly tiles and hides the
  subscription tiles.
- The token packs section is not present in the DOM in either tab.
- No backend or plan-data change; `GET /billing/plans` still drives the tiles.

### Tests (frontend, Playwright or component per repo convention)

- Default state: `subscriptions-section` visible, `plan-cards` (passes) hidden,
  token packs absent.
- Click Passes: pass tiles for `daily`/`weekly`/`monthly` visible, subscription
  tiles hidden.
- Assert the token store test id is never in the document.

---

## Feature C: Email verification on registration, Google sign-ups auto-verified

### Goal

Verify a user's email on email/password registration via a Resend link. Until
verified, hard-block the user from the protected app and route them to a
`/verify-email` screen. Google sign-ups are auto-verified (Google already asserts
`email_verified`). Double-check the Google flow persists verification.

Decision (locked): hard block until verified.

### Current state (verified)

- Custom JWT auth (`jose`), cookie `buttercupp_auth`. Core in `frontend/lib/auth.ts`
  (`requireAuth()` ~190-194, `requireAgeVerified()` ~198-207, token audiences
  `JWT_AUD_AUTH`/`JWT_AUD_RESET`/`JWT_AUD_MAGIC`, `signResetToken` ~84-93).
- Signup: `frontend/app/api/auth/signup/route.ts` (creates the user, sets age/ToS/
  privacy timestamps, issues the auth cookie immediately, sends a welcome email
  ~lines 60-69). No verification today.
- Login: `frontend/app/api/auth/login/route.ts` (password check only, no
  verification check).
- Google OAuth: `frontend/app/api/auth/oauth/google/route.ts` (verifies Google ID
  token, requires `email_verified=true` at line ~44 but does NOT persist it;
  create/link paths ~lines 50-65).
- Email sending already exists: `frontend/lib/email.ts` (`sendEmail`, `emailShell`,
  Resend via `fetch`, dev fallback logs to console). Env: `RESEND_API_KEY`,
  `EMAIL_FROM`. Resend is not a package dependency (called over HTTP), so no
  install needed.
- `MagicLink` table exists (`schema.prisma` ~194-207: `userId`, `tokenHash` unique,
  `purpose`, `expiresAt`, `consumedAt`) with a consume route at
  `frontend/app/api/auth/magic-link/consume/route.ts`. Reuse this pattern for
  verification tokens.
- Gating is server-side in layouts (`(protected)/layout.tsx` calls `requireAuth()`
  then `ConsentGate`). Middleware (`frontend/middleware.ts`) cannot read the DB
  (edge runtime), so the verification gate must live in the protected layout, not
  middleware.
- User model has NO `emailVerifiedAt` field (schema ~106-155).

### Changes

1. **Schema + LOCAL migration**: add `emailVerifiedAt DateTime?` to `User` in
   `packages/database/prisma/schema.prisma`. Generate the migration and run it
   against the LOCAL database only (`prisma migrate dev`). The prod migration is a
   Manual step. Backfill note for prod is in Manual steps (existing users should be
   treated as verified so they are not locked out; see Manual steps).
2. **Verification token**: reuse `MagicLink` with `purpose: "email-verify"`. Add a
   helper in `frontend/lib/auth.ts` or a small `frontend/lib/email-verify.ts`:
   `issueEmailVerification(userId, email)` creates a `MagicLink` row (hashed token,
   short expiry, for example 24h) and returns the raw token; `consumeEmailVerification(token)`
   validates, marks `consumedAt`, and sets `User.emailVerifiedAt = now()`.
3. **Signup** (`api/auth/signup/route.ts`): after creating the user, do NOT set
   `emailVerifiedAt`. Call `issueEmailVerification` and send a verification email
   via `sendEmail` with a link to `${APP_URL}/api/auth/verify-email?token=...`.
   Still issue the auth cookie (so they can reach `/verify-email` and resend), but
   the protected layout gate blocks app usage until verified. Replace or augment
   the current welcome email with the verification email.
4. **Verify endpoint**: `frontend/app/api/auth/verify-email/route.ts` (GET). Read
   `token`, call `consumeEmailVerification`, on success redirect to `/onboarding`
   or `/dashboard`; on failure redirect to `/verify-email?error=expired`.
5. **Verify screen**: `frontend/app/verify-email/page.tsx` (outside `(protected)`),
   explains "check your inbox", shows the signed-in email, and a "resend" button
   posting to `frontend/app/api/auth/verify-email/resend/route.ts` (rate-limited,
   re-issues a token and re-sends). If already verified, redirect to `/dashboard`.
6. **Gate**: add `requireEmailVerified()` to `frontend/lib/auth.ts` (reads the
   user row, redirects to `/verify-email` when `emailVerifiedAt` is null and the
   user is NOT an OAuth Google user). Call it in `(protected)/layout.tsx` after
   `requireAuth()` and before `ConsentGate`.
7. **Google OAuth** (`api/auth/oauth/google/route.ts`): on both the create-new and
   the link-existing paths, set `emailVerifiedAt = now()` (Google already asserts
   `email_verified` at line ~44). Confirm an existing password user who links
   Google becomes verified. No verification email for Google.
8. **Login** (`api/auth/login/route.ts`): keep allowing login (do not block here);
   the protected layout gate handles the redirect. This lets unverified users reach
   `/verify-email` to resend.
9. **Env**: document `RESEND_API_KEY` and `EMAIL_FROM` in `frontend/.env.example`
   (already referenced by `lib/email.ts`). The human provides the real key and
   from-address (Manual steps).

### Acceptance criteria

- A new email/password signup creates a user with `emailVerifiedAt = null`, sends
  a verification email (in dev, logged to console by `lib/email.ts`), and cannot
  reach `/chat`, `/create`, `/settings`, `/billing`; they are redirected to
  `/verify-email`.
- Visiting a valid verification link sets `emailVerifiedAt` and unblocks the app.
- Resend issues a fresh token and email and invalidates prior unconsumed tokens (or
  simply issues a new valid one).
- A Google sign-up (new or linking) has `emailVerifiedAt` set and is never blocked
  by the gate.
- Middleware is unchanged; the gate is layout-level.

### Tests (frontend, mock `sendEmail` and prisma)

- signup creates an unverified user and calls `sendEmail` once with a link
  containing the token.
- `consumeEmailVerification` sets `emailVerifiedAt` for a valid token; rejects an
  expired or already-consumed token.
- `requireEmailVerified` redirects an unverified password user and passes a
  verified user and any Google user.
- Google OAuth create and link paths both set `emailVerifiedAt` (extend
  `app/api/auth/oauth/google/route.test.ts`).

---

## Feature D: Persona images to S3 and CharacterMedia (local now, prod on approval)

### Goal

For all 143 characters, take the generated persona variants (5 per character),
KEEP the four we want, drop the fifth, convert PNG to WebP, upload to S3, and link
each as a `CharacterMedia` row in both the LOCAL and the PRODUCTION database. The
character's CURRENT hero image stays the hero (do not change its `isPrimary` or
`isDisplay`); the four variants are added as additional non-hero gallery images.

Decisions (locked): existing hero stays hero; store four generated images per
character in S3; drop the fifth variant.

### Current state (verified)

- Source: `Plans/inference-aws/persona-output/{id}_p{1..5}/variant-p{v}-v1.png`,
  ids 1..143, 715 PNG files total (5 per character). Each dir has a `manifest.json`
  whose `main_image` points at the existing hero
  `frontend/public/personas/{id}.webp` and whose variant `s3Key` is empty (never
  uploaded). A second set exists at `persona-output-v2/`; scope this feature to
  `persona-output/` unless told otherwise.
- WebP conversion: `backend/src/media/image/convert.ts` `toWebP(buffer)` (sharp,
  quality 85; graceful fallback if sharp missing).
- S3: `backend/src/media/storage.ts` (`uploadGenerated`, `bucketForKey`: keys under
  `images/` route to `POPPY_S3_BUCKET_GENERATED`; `S3_ENDPOINT` set means MinIO
  path-style for local, empty means real AWS). Key convention example
  `images/{userId}/{uuid}.webp`.
- Models: `CharacterMedia` (`schema.prisma` ~607-638: `characterId`, `kind`, `url`
  = raw S3 key, `isPrimary`, `isDisplay`, `hidden`, `sort`, indexes). `MediaAsset`
  (~479-499). Phase 28 dual-write helper `attachCreationCharacterMedia` in the
  worker calls `backfillCharacterDisplay(characterId)` which recomputes the
  `isDisplay` winner.
- DB URL selection: `packages/database/src/client.ts` `getDbUrl()` reads
  `DATABASE_URL` and injects pool params.

### Changes

1. **Backfill script** `backend/scripts/link-persona-media.ts` (a Node/TS script so
   it can import the backend `toWebP`, the S3 storage client, and the `prisma`
   singleton). It must:
   - Read a `TARGET` env (`local` default) that maps to the `DATABASE_URL` in the
     environment; NEVER hardcode a prod URL. Read the bucket and `S3_ENDPOINT` from
     env the same way the backend does. Support `DRY_RUN=1` (default ON: print the
     plan, touch nothing) and an explicit `APPLY=1` to perform writes. Support
     `LIMIT=<n>` and `ONLY=<id[,id...]>` for staged runs.
   - Enumerate `Plans/inference-aws/persona-output/{id}_p{1..5}`. For each
     character keep variants `p1..p4` and drop `p5` (the fifth). Move each dropped
     `p5` directory to `Plans/inference-aws/persona-output/_trashed/{id}_p5/`
     (recoverable, not a hard delete) only when `APPLY=1`; in dry run just report
     it.
   - For each kept variant: read the PNG, `toWebP` it, upload to a deterministic S3
     key `images/personas/{characterId}/p{v}.webp` (deterministic so re-runs are
     idempotent and route to `POPPY_S3_BUCKET_GENERATED` via `bucketForKey`).
   - Upsert a `CharacterMedia` row keyed by `(characterId, url)`:
     `{ characterId, kind: "image", url: <s3Key>, isPrimary: false, isDisplay: false, hidden: false, sort: v }`.
     Do NOT call `backfillCharacterDisplay` and do NOT set `isPrimary`/`isDisplay`;
     the existing hero must keep its flags. Before inserting, assert the character
     already has exactly one `isDisplay=true` (the hero); if it has zero, log a
     warning and skip flipping anything (leave hero handling to a human), do not
     silently promote a variant.
   - Optionally create a matching `MediaAsset` row (kind `image`, status `ready`,
     `s3Key`, a system `userId`) for observability; make this behind a flag and OFF
     by default since gallery/cards/chat read `CharacterMedia`.
   - Write a machine-readable output manifest
     `Plans/inference-aws/persona-media-manifest.json` mapping
     `characterId -> [{ variant, pngPath, s3Key, characterMediaId }]`. Feature E
     consumes this to pair PNG and WebP and to find rows to delete.
   - Print a summary: characters processed, variants uploaded, rows upserted, p5
     dirs trashed, and any characters missing a hero.

2. **Local run** (safe, do it as part of implementation):
   - Ensure local Postgres and, if used, local MinIO are up. Run with `DRY_RUN=1`
     first and eyeball the plan, then `APPLY=1 TARGET=local` to upload to the local
     bucket and write local `CharacterMedia`. Verify a few characters render four
     extra images plus the unchanged hero.

3. **Prod run**: NOT performed by the agent. See Manual steps. Same script with the
   prod `DATABASE_URL` and prod bucket and `APPLY=1`, run by a human after
   reviewing the dry-run plan.

### Acceptance criteria

- Dry run prints, per character, the four kept variants, their target S3 keys, the
  `CharacterMedia` upserts, and the p5 dir it would trash, and writes no data.
- After the LOCAL apply: each processed character has its original hero unchanged
  (`isPrimary`/`isDisplay` identical to before) plus four new `CharacterMedia`
  image rows with `sort` 1..4, `isPrimary=false`, `isDisplay=false`, `hidden=false`,
  and `url` pointing at `images/personas/{id}/p{v}.webp`.
- Re-running is idempotent (no duplicate rows, no duplicate uploads).
- `persona-media-manifest.json` is written and lists every uploaded key and its
  `characterMediaId`.
- No character ends with zero or two `isDisplay=true` rows as a result of the run.

### Tests (backend, mock S3 and prisma; use fixture dirs)

Add `backend/scripts/__tests__/link-persona-media.test.ts`:

- variant selection keeps p1..p4 and drops p5 for a character with five dirs; a
  character with fewer than five is handled without throwing.
- key builder produces `images/personas/{id}/p{v}.webp` and routes to the generated
  bucket via `bucketForKey`.
- upsert is idempotent on `(characterId, url)` (second run inserts nothing).
- the "do not touch hero" invariant: given a character with one existing
  `isDisplay=true` row, after the run that row is unchanged and no variant has
  `isDisplay=true`; given a character with zero display rows, the script warns and
  does not promote a variant.
- `DRY_RUN` performs no prisma writes and no S3 puts (assert on mocks).

---

## Feature E: Claude Haiku distortion scan, report first, delete on approval

### Goal

Scan the persona images in S3 with Claude Haiku (vision) to find distorted,
blurry, or anatomically broken images. Produce a REPORT only. After a human
approves the report, a separate gated deletion removes the flagged assets from S3
and from BOTH the local and the production databases. Because each WebP is derived
from a source PNG, a flagged image deletes its whole pair (PNG plus WebP) and its
`CharacterMedia` (and any `MediaAsset`) row.

Decision (locked): report first, human approves, then delete. Depends on Feature D
having uploaded the images.

### Current state (verified)

- Anthropic SDK is already loadable: `backend/src/llm/provider.ts` `getAnthropicClient()`
  requires `ANTHROPIC_API_KEY` and lazy-loads `@anthropic-ai/sdk`. Streaming and
  non-streaming Anthropic calls already exist there.
- Latest Haiku model id: `claude-haiku-4-5-20251001` (see the `claude-api` skill /
  `MODELS` in `backend/src/llm/constants.ts`; use the constant, do not hardcode a
  stale id). Haiku supports image input for vision.
- S3 read/presign: `backend/src/media/storage.ts` `getGeneratedSignedUrl(s3Key)`
  (CloudFront in prod, S3 presigned locally). `bucketForKey` for deletes.
- Feature D writes `persona-media-manifest.json` pairing PNG and WebP and listing
  `characterMediaId` per key. Use it as the pairing source of truth.

### Changes

1. **Scan script** `backend/scripts/scan-distortion.ts`:
   - Input: the S3 keys from `persona-media-manifest.json` (WebP) plus, if any
     source PNGs also live in S3, their keys. Handle both WebP and PNG.
   - For each image: fetch bytes (via a presigned URL or direct S3 get), send to
     Claude Haiku as an image block with a strict JSON-only instruction asking for
     `{ distorted: boolean, blurry: boolean, anatomy_ok: boolean, confidence: number, reason: string }`.
     Parse defensively (the model must return JSON; on parse failure, mark as
     `needs_review` rather than deleting).
   - Concurrency-limit the calls (for example 4 at a time), retry transient errors,
     and respect a `LIMIT` env for a cheap first pass.
   - Flag an image when `distorted || blurry || !anatomy_ok` above a confidence
     threshold (env `DISTORTION_MIN_CONFIDENCE`, default 0.75).
   - Output `Plans/inference-aws/distortion-report.json` and a human-readable
     `distortion-report.txt`: per flagged item `{ characterId, variant, webpKey,
     pngKey, characterMediaId, mediaAssetId?, confidence, reason }`, plus totals
     and a `needs_review` list. The scan NEVER deletes.

2. **Deletion script** `backend/scripts/delete-flagged-media.ts` (gated, prod is a
   human action):
   - Input: an APPROVED `distortion-report.json` and `TARGET` (local or, by human,
     prod) plus `DRY_RUN`/`APPLY`.
   - For each flagged item: delete the WebP and the paired PNG from S3 (correct
     bucket via `bucketForKey`), delete the `CharacterMedia` row by id, and delete
     any linked `MediaAsset` row. This is an intentional hard delete of distorted
     assets (it overrides the usual "hidden is never deleted" convention, since the
     point is removal). If deleting a row would drop a character's hero display,
     STOP and report that character instead of deleting (never leave a character
     with zero display images).
   - Idempotent: skip keys/rows already gone. Print a per-item applied/skipped log.
   - Run against LOCAL only during implementation; prod is a Manual step after
     approval.

3. **Env**: `ANTHROPIC_API_KEY` (already used by the LLM chain),
   `DISTORTION_MIN_CONFIDENCE` documented in `backend/.env.example`.

### Acceptance criteria

- The scan produces `distortion-report.json` and a readable summary and deletes
  nothing.
- Every flagged item lists both the WebP and paired PNG keys and the DB row ids to
  remove.
- The deletion script, run with `DRY_RUN`, prints exactly the S3 keys and DB rows
  it would remove from the approved report and touches nothing.
- Applied against LOCAL, it removes exactly the approved flagged assets from S3 and
  both `CharacterMedia` and `MediaAsset`, is idempotent on re-run, and never leaves
  a character with zero display images.
- Prod deletion is not performed by the agent.

### Tests (backend, mock Anthropic client, S3, prisma)

Add `backend/scripts/__tests__/scan-distortion.test.ts`:

- a mocked Haiku response of `{distorted:true,confidence:0.9,...}` flags the item;
  a clean high-confidence response does not; a non-JSON response yields
  `needs_review`, not a flag.
- confidence threshold gating (0.7 result does not flag at default 0.75).
- report includes both webpKey and pngKey for a flagged item using the manifest
  pairing.

Add `backend/scripts/__tests__/delete-flagged-media.test.ts`:

- dry run performs no S3 delete and no prisma delete (assert mocks).
- apply deletes the paired keys and the correct rows and is idempotent.
- refuses to delete when it would drop a character's only display image (asserts a
  stop/report, no delete).

---

## Feature F: R&D on uncensored companion LLMs used by market leaders

### Goal

Produce a research document identifying which uncensored AI-companion LLM the
major market leaders use for effective conversation, and recommend what ButterCupp
should trial to beat the current Stheno 8B. This is a RESEARCH deliverable only:
no change to the inference chain (swapping the served model is a separate GPU
operation that needs its own approval).

Decision (locked): market-leader competitive research, research doc as output.

### Current state (verified)

- Current model: `L3-8B-Stheno-v3.2` (`backend/src/llm/constants.ts`), served on a
  self-hosted GPU box (llama.cpp OpenAI-compatible endpoint, 12s fast-fail,
  circuit breaker) with an OpenRouter fallback (`nousresearch/hermes-3-llama-3.1-70b`
  for mature content) then Anthropic/OpenAI (`backend/src/llm/provider.ts`).
- Constraints: uncensored NSFW roleplay, 8k+ context, self-hostable on a 24GB A10G
  (co-located with Juggernaut XL, roughly 16-18GB used) OR available via
  OpenRouter, latency budget under the 12s fast-fail with a target first-token
  under 1-2s (`Plans/prds/master-prd.md`).
- Prior notes: `Plans/llm-list.md` already lists candidates (EVA Qwen 2.5 32B,
  Mistral-Small 22B variants, Midnight Rose 70B, Behemoth/Monstral 123B, Lumimaid).
- Hardware and cost: `Plans/model-hosting-aws-cost-analysis.md`.

### Changes

1. Use web search to gather current (as of the implementation date) intel on what
   the major companion products use or are believed to use for their chat model,
   covering at least: Character.AI, Candy.AI, JanitorAI, SpicyChat, DreamGF,
   Muah.AI, CrushOn.AI, Replika. Note where a product self-hosts a fine-tune vs
   routes to an API, and any publicly known base models or fine-tune families.
2. Write `Plans/llm-rnd-market-leaders-2026-08.md` containing:
   - A short summary of the market-leader landscape and the pattern (self-hosted
     open-weight roleplay fine-tunes vs hosted uncensored APIs).
   - A comparison table of the top open-weight candidates scored against our
     constraints: uncensored quality, roleplay/prose, context window, VRAM fit on
     24GB (with quantization), self-host vs OpenRouter availability, and expected
     latency and cost.
   - A ranked recommendation for the next model to trial, with a concrete "how to
     A/B without a code change" note (the chat model is already env-selectable via
     `POPPY_CHAT_MODEL`; document how to point it at a candidate on the GPU box or
     an OpenRouter model id, and what to measure).
   - A clear statement that deploying a new served model is a separate,
     approval-gated GPU operation and is out of scope for this prompt.
   - Cite sources inline. Cross-reference and reconcile with `Plans/llm-list.md`.

### Acceptance criteria

- `Plans/llm-rnd-market-leaders-2026-08.md` exists, covers the named products,
  includes the scored comparison table and a single ranked recommendation, and
  makes no change to `backend/src/llm/*`.
- `npm run check:no-em-dash` stays green on the new doc.

### Tests

- None (editorial). The Global sanity `check:no-em-dash` covers the doc.

---

## Feature G: Meta Pixel "Lead" event on signup

### Goal

Fire a Meta (Facebook) Pixel `Lead` standard event when a user completes account
creation (enters email plus password and creates the account). The base pixel and
`PageView` are already installed globally; `Lead` must fire ONLY on a successful
signup, not on every page load.

### Current state (verified)

- The base Meta Pixel is already installed in `frontend/app/layout.tsx` (a
  `next/script` `afterInteractive` block, pixel id `2065090824399737`) and fires
  `fbq('track', 'PageView')` on every page. It does not fire `Lead`. Do NOT add a
  second base pixel and do NOT put `Lead` in the layout (that would fire it on
  every page).
- The signup form is a client component:
  `frontend/app/signup/SignupForm.tsx`. It POSTs to `/api/auth/signup` and, on a
  successful response, calls `router.push("/dashboard")`. That success point is
  where `Lead` belongs (client-side; the server route cannot call `fbq`).
- Reference implementation to mirror: Pellow's
  `frontend/lib/marketing/meta-pixel.ts` (a guarded `metaTrack` helper) and
  `frontend/components/meta-pixel.tsx` (consent-gated pixel plus a server-side
  Conversions API in `meta-capi.ts`). Poppy's current pixel is ungated, so the
  minimal port omits consent gating and CAPI (see the optional upgrade note).

### Changes

1. Add `frontend/lib/marketing/meta-pixel.ts`: a small `metaTrack(event, data?, eventID?)`
   helper that is SSR-safe (no-op when `window` is undefined), retries briefly if
   `fbq` is not loaded yet (about 5s, then a one-shot kill flag), and uses
   `fbq('track', ...)` for standard events. Type the event union to include
   `"Lead"` and `"CompleteRegistration"` at least.
2. In `frontend/app/signup/SignupForm.tsx`, after the signup fetch succeeds and
   before `router.push("/dashboard")`, call
   `metaTrack("Lead", { content_name: "signup" })`. It is fire-and-forget; fbq
   queues and sends asynchronously so it survives the redirect.
3. Do NOT fire `Lead` on login. Do NOT fire it on failed signups.

### Optional (do not build unless asked)

- Google sign-up as a `Lead`: only fire when the OAuth flow creates a NEW account
  (not on Google login of an existing user). This needs the
  `/api/auth/oauth/google` response to expose a "created" flag; wire it only if
  that flag exists, otherwise leave it out to avoid counting logins as leads.
- Consent gating and a server-side Conversions API (Meta CAPI with hashed email
  and an `eventID` for pixel plus CAPI dedupe), mirroring Pellow. Recommended for
  an adult platform with EU traffic, but out of scope here since the existing
  Poppy pixel is ungated.

### Acceptance criteria

- On a successful email plus password signup, exactly one `Lead` event fires
  client-side (verify with the Meta Pixel Helper or the Network tab: a request to
  `facebook.com/tr` with `ev=Lead`).
- No `Lead` fires on page load, on login, or on a failed signup.
- The base pixel and `PageView` in `layout.tsx` are unchanged; no duplicate pixel
  is added.

### Tests (frontend, mock `window.fbq`)

- `metaTrack` no-ops on the server (no `window`) and does not throw.
- `metaTrack("Lead")` calls `window.fbq("track", "Lead", ...)` once when fbq is
  present.
- SignupForm: a mocked successful POST triggers one `metaTrack("Lead")`; a mocked
  failed POST triggers none (mock the helper and assert call counts).

---

## Global sanity (run after all features)

From the repo root:

```bash
npm install
npm run typecheck
npm run check:no-em-dash
npm run build
npm test
npx eslint .
```

All must pass. Then boot the app locally and manually verify:

- Chat: open a new chat, confirm a personalized in-character check-in appears;
  reopen within 24h and confirm no new check-in; force the LLM off and confirm the
  static greeting fallback still opens the chat.
- Billing: the page shows the Subscription tab active with both subscription tiles
  and no token packs; clicking Passes shows Daily, Weekly, Monthly.
- Email verify: a fresh signup is blocked from `/chat` and redirected to
  `/verify-email`; the dev console shows the verification email; consuming the link
  unblocks; a Google sign-in is never blocked.
- Persona media (local): a few characters show four extra images plus an unchanged
  hero; `persona-media-manifest.json` exists.
- Distortion scan (local): `distortion-report.json` exists; the deletion dry run
  prints the expected keys and rows and deletes nothing.
- LLM R&D: `Plans/llm-rnd-market-leaders-2026-08.md` reads well and is grounded.
- Meta Pixel: complete a signup and confirm one `facebook.com/tr?...ev=Lead`
  request fires (Meta Pixel Helper or Network tab); confirm no `Lead` on page load
  or login.

Do not commit, push, or deploy. Leave the working tree for the human to review.

---

## Manual steps (human, required for prod-touching actions)

1. **Email env**: set `RESEND_API_KEY` and `EMAIL_FROM` locally now and in prod
   secrets at deploy time.
2. **User `emailVerifiedAt` migration (prod)**: apply the migration to the prod DB
   as a fresh, explicit, approved action. Backfill existing users to
   `emailVerifiedAt = createdAt` (or now) so current users are not locked out by
   the new gate.
3. **Feature D prod apply**: after reviewing the LOCAL dry-run plan, run
   `backend/scripts/link-persona-media.ts` with the prod `DATABASE_URL` and prod
   bucket and `APPLY=1`. This writes prod `CharacterMedia` and uploads to prod S3;
   it requires a fresh, explicit go for that exact action.
4. **Feature E scan cost**: the Haiku scan calls the Anthropic API per image
   (roughly 570 to 715 images); run the scan with a `LIMIT` first to gauge cost.
5. **Feature E prod delete**: only after a human reviews and approves
   `distortion-report.json`, run `backend/scripts/delete-flagged-media.ts` against
   prod with `APPLY=1`. This hard-deletes prod S3 objects and prod DB rows and
   requires a fresh, explicit go for that exact action.
6. **Serving a new LLM (feature F)**: deploying any recommended model to the GPU
   box is a separate approval-gated operation, not part of this prompt.
