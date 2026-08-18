# 33 - Context-aware image gen, recurring subscriptions, review revamp, reels to S3

This prompt covers four independent features. Implement them in the order
below. Each feature has: what to build, exact files and symbols to touch,
acceptance criteria, and tests. A short "Manual steps" section at the very end
lists the few things a human must do outside the code.

## Ground rules (read first, do not skip)

- Follow `CLAUDE.md` at the repo root. It wins over anything else.
- Prisma singleton is a hard rule: import `{ prisma }` from
  `@buttercupp/database`. Never `new PrismaClient()` outside
  `packages/database/src/client.ts`.
- No em dash characters anywhere (code, comments, copy, docs). Use commas,
  periods, or parentheses. `npm run check:no-em-dash` must stay green.
- TypeScript strict everywhere. Validate every trust boundary with `zod`. No
  `any` without a comment explaining why.
- Payments are adult-processor only. `dodo` is the primary. `stripe` and
  `paypal` are compile-time forbidden (see `backend/src/payments/types.ts`).
  Do not add them.
- DO NOT commit, push, deploy, push Docker images, run migrations against any
  non-local database, create Dodo dashboard products, or rotate secrets. Those
  are human actions. Stop and leave them for the "Manual steps" section.
- Fine to run locally without asking: `npm install`, `npm run typecheck`,
  `npm run build`, `npm test`, `eslint`, `docker build` with no push, `psql`
  against a local DB, and `aws s3` dry runs.
- After each feature: run typecheck, lint, and that feature's tests before
  moving on. At the end run the full sanity suite in the "Global sanity" block.

---

## Feature 1: Context-aware in-chat image generation

### Goal

When a user asks an in-chat character to generate an image, the image model
(Juggernaut / ComfyUI) must NOT receive the user's raw command. Instead:

1. The user's literal request is the PRIMARY intent. Every element and detail
   in it must be preserved exactly (subject, setting, clothing, pose, mood).
   Nothing in the user's request may be dropped or overridden.
2. A background context block is assembled from the recent conversation: the
   last 10 to 20 raw turns PLUS a short running summary of the conversation.
   This is SECONDARY. It may add flavor (location continuity, relationship
   tone, time of day) but must never override the user's explicit request.
3. Both are fed to Stheno (the chat LLM). Stheno produces the character's chat
   reply (the teaser, already implemented) and, separately, enriches the image
   prompt by merging the preserved user request with the background context.
4. Only the Stheno-enriched prompt string is passed to Juggernaut. The raw user
   command is never the prompt sent to the image model.

Most of this pipeline already exists. The work is to feed conversation context
into the enrichment step and to lock in the "user request is preserved,
background is secondary" priority.

### Current state (verified)

- Intent detection: `backend/src/media/image/decision.ts`, `isImageRequest()`.
  Called from `backend/src/ws/gateway.ts` and
  `backend/src/http/chat-stream.ts`. No change needed here.
- Teaser (Stheno chat reply): `generateImageTeaser()` invoked in the gateway
  and SSE handlers. No change needed; keep it.
- Image turn: `backend/src/chat/image-turn.ts`.
  - `generateChatImage(userText, conversationId?, userId?)` is the entry point.
  - `cleanImagePrompt(userText)` strips request phrasing ("send me a photo of
    ..." becomes "..."). Keep it.
  - `enrichImagePrompt(rawPrompt)` calls Stheno directly at
    `${resolvePoppyBaseUrl("stheno")}/v1/chat/completions` with a system prompt
    from `backend/src/media/image/enrichment-fills.ts`
    (`IMAGE_ENRICHMENT_FILLS`). On any failure it falls back to `rawPrompt`.
  - The enriched string is passed to `generateImage()` /
    `generateWithComfyUIConsistent()` in `backend/src/media/image/providers.ts`.
    These already receive only the enriched prompt. Do not change providers.
- History assembly reference (copy this pattern):
  `backend/src/chat/engine.ts` fetches the last 20 turns
  (`HISTORY_TURNS = 20`), and sanitizes `data:image/...` payloads to
  `[shared a photo]`. A running summary is available via `getLatestSummary()`
  in `backend/src/llm/memory-retriever.ts`.

### Changes

1. **`backend/src/chat/image-turn.ts`**
   - Add a context builder, `buildImageContext(conversationId, userId)`, that:
     - Loads the last `IMAGE_CONTEXT_TURNS` messages for the conversation
       (default 15, clamp 10 to 20) with
       `prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take })`,
       then reverses to chronological order.
     - Sanitizes each message the same way `engine.ts` does (replace embedded
       `data:image/...` blobs with `[shared a photo]`) so no base64 leaks into
       the prompt.
     - Fetches the running summary via `getLatestSummary(userId, characterId)`
       when `userId` and the resolved `characterId` are available. If missing,
       the summary is an empty string (do not fail).
     - Returns `{ recentTurns: string; summary: string }` where `recentTurns`
       is a compact transcript (for example `User: ...\nAria: ...`), truncated
       to a safe character budget (cap around 1500 chars so the enrichment call
       stays fast).
     - Any DB error inside this builder is swallowed and returns empty context.
       Image generation must still work with zero context.
   - Change `enrichImagePrompt` to accept context:
     `enrichImagePrompt(rawPrompt, context?: { recentTurns: string; summary: string })`.
     Build the Stheno call as:
     - system: the existing `IMAGE_ENRICHMENT_FILLS` system prompt, extended
       (in `enrichment-fills.ts`, see below) to state the priority rule.
     - user: a single structured message, for example:

       ```
       PRIMARY IMAGE REQUEST (preserve every detail exactly, do not drop or
       change any element):
       {rawPrompt}

       BACKGROUND CONTEXT (secondary, use only to add consistent flavor, never
       to override the primary request):
       Summary: {summary}
       Recent conversation:
       {recentTurns}

       Produce one vivid image-generation prompt under 150 words that fully
       preserves the primary request and layers in consistent background flavor
       where it does not conflict.
       ```
     - Keep `max_tokens` around 250, `temperature` around 0.7.
     - Keep the existing fallback: on any non-OK response, network error, or
       empty content, return the raw (cleaned) prompt unchanged.
   - In `generateChatImage`, call `buildImageContext(...)` (guarded by
     `conversationId`) and pass the result into `enrichImagePrompt(cleaned, ctx)`.
     Preserve the existing character-reference-face (InstantID) path unchanged.
   - Add a module constant `IMAGE_CONTEXT_TURNS = 15` (clamped 10 to 20).

2. **`backend/src/media/image/enrichment-fills.ts`**
   - Extend the system prompt so it explicitly says: the PRIMARY request is
     authoritative and every element in it must survive into the final prompt;
     BACKGROUND CONTEXT is secondary and may only add non-conflicting detail;
     never introduce a subject, setting, or wardrobe that contradicts the
     primary request. Keep the existing style/quality-tag guidance. No em dash.

3. Do not change `gateway.ts` / `chat-stream.ts` call sites beyond what already
   passes `conversationId` and `userId` into `generateChatImage`. They already
   pass those. The teaser stays as-is.

### Acceptance criteria

- The string passed to `generateImage()` / `generateWithComfyUIConsistent()` is
  always the enriched prompt, never the raw `userText`.
- When Stheno is reachable, the enriched prompt provably contains the user's
  explicit elements (subject and any stated setting/wardrobe/pose survive).
- Background context is included in the enrichment call input, but a background
  detail that conflicts with the user request never replaces the user request.
- When Stheno is unreachable, generation still proceeds using the cleaned
  prompt (existing fallback), and no exception escapes `generateChatImage`.
- Zero base64 image data is ever placed into the enrichment prompt.

### Tests (backend, mock the Stheno fetch)

Add `backend/src/chat/__tests__/image-turn.context.test.ts` (match the repo's
existing test runner and mocking style):

- `buildImageContext` returns at most 20 and at least 10 turns, chronological,
  with `data:image` payloads replaced by `[shared a photo]`.
- `buildImageContext` returns empty context (no throw) when the DB call rejects.
- `enrichImagePrompt` sends a payload whose PRIMARY block equals the raw prompt
  verbatim and whose BACKGROUND block contains the summary and recent turns.
- `enrichImagePrompt` returns the raw cleaned prompt when the mocked Stheno
  fetch returns non-OK or empty content.
- `generateChatImage` passes the enriched prompt (mocked return) into the image
  provider, and never passes `userText` directly (assert on the provider mock
  call argument).

---

## Feature 2: Recurring subscription tiers (monthly + yearly) via Dodo

### Goal

Add two RECURRING subscription plans alongside the existing one-time passes.
The one-time passes stay exactly as they are (Daily $1, Weekly $6, Monthly $25).

New plans (high-but-capped quotas that refresh every calendar month):

| plan key     | label                | price     | billing  | chats  | images | videos |
|--------------|----------------------|-----------|----------|--------|--------|--------|
| `sub_monthly`| Monthly Subscription | $19.99/mo | recurring| 10000  | 600    | 120    |
| `sub_yearly` | Yearly Subscription  | $149/yr   | recurring| 10000  | 600    | 120    |

Quotas refresh every calendar month for BOTH subscription plans (the yearly
plan does not grant a full year of quota at once; it refreshes monthly like the
monthly plan). The one-time passes keep their existing expiry-pinned windows.

The billing architecture already supports arbitrary plans. `Subscription.plan`
is a nullable `String` (no schema change needed). The Dodo webhook already maps
`subscription.renewed` and `subscription.active` to `subscription.activated`,
so auto-renewal already re-extends the pass with no new code.

### Changes

1. **`backend/src/subscription/plans.ts`**
   - Extend the `Plan` union with `"sub_monthly"` and `"sub_yearly"`.
   - Add both entries to `PLANS` with the quotas above,
     `durationDays: 30` for `sub_monthly` and `durationDays: 365` for
     `sub_yearly` (this pins `currentPeriodEnd` / the renewal window),
     `priceUsd: 19.99` and `149` respectively, and a `recurring: true` flag
     (add this optional field to the plan config type; existing passes get
     `recurring: false` or leave undefined).
   - Add both keys to `PLANS_ORDER` after `monthly`.
   - Update `isPaidPlan()` so both new plans count as paid.
   - If a `billingInterval` label ("month" / "year") helps the UI, add it to the
     plan config; otherwise the UI can derive it. Keep it minimal.

2. **`backend/src/subscription/period.ts`**
   - `planPeriodKey(plan, currentPeriodEnd)` currently stamps the expiry date.
     For recurring subscription plans (`sub_monthly`, `sub_yearly`) return a
     calendar-month key instead, for example `${plan}:${YYYY}-${MM}` using the
     current date, so quotas reset at each month boundary regardless of the
     annual expiry. One-time passes keep the existing expiry-pinned behavior.

3. **`backend/src/subscription/grant.ts`**
   - `tierForPlan()`: map both `sub_monthly` and `sub_yearly` to the top tier
     (`"pro"`). `activatePlan()` already sets `currentPeriodEnd` from
     `planExpiryFrom(plan)`, which now reads the new `durationDays`. No other
     change needed here.

4. **`backend/src/subscription/entitlements.ts`**
   - Ensure the `isPlan` type guard (and any plan allow-list) includes the two
     new plans so `entitlementsFor()` resolves their quotas. The active-pass
     check (`isPaidPlan` + `status === "active"` + not expired) already works.

5. **`backend/src/payments/dodo.ts`**
   - No code change required: `resolveProductId()` already maps
     `plan -> DODO_PRODUCT_${plan.toUpperCase()}`, so `sub_monthly` resolves to
     `DODO_PRODUCT_SUB_MONTHLY` and `sub_yearly` to `DODO_PRODUCT_SUB_YEARLY`.
     Confirm the checkout `metadata.plan` is set (it already is). Dodo detects
     one-time vs subscription at the product level, so the same
     `checkoutSessions.create` call works for recurring products.

6. **`backend/.env.example`**
   - Add the two new product env vars with empty values and a comment:
     `DODO_PRODUCT_SUB_MONTHLY=` and `DODO_PRODUCT_SUB_YEARLY=`.

7. **`backend/src/payments/webhooks/dodo.ts`**
   - No change: `EVENT_MAP` already normalizes `subscription.active`,
     `subscription.renewed`, `subscription.cancelled`, `subscription.expired`,
     etc. Verify the normalize step carries `metadata.plan` for subscription
     products (it does). Add a test rather than code.

8. **Zod / request validation**
   - Wherever `POST /billing/subscribe` validates the `plan` field
     (`backend/src/http/billing.ts`), widen the accepted enum to include
     `sub_monthly` and `sub_yearly`.

9. **`frontend/app/(protected)/billing/BillingClient.tsx`**
   - The plan catalog is fetched from `GET /billing/plans` (dynamic), so the new
     plans appear automatically in the data. Add UI so they render as a
     distinct "Subscriptions" section (recurring, auto-renew) separate from the
     one-time "Passes" section. Show price with the interval (`/mo`, `/yr`) and
     a "Save ..." badge on yearly computed from the two prices.
   - Widen the local `Plan` union / `highlightPlan` type to include the two new
     keys.
   - Reuse the existing purchase flow: `POST /billing/subscribe { plan }` then
     redirect to `checkoutUrl`. No new client transport.

10. **`frontend/app/(protected)/billing/page.tsx`**
    - Widen the `highlightPlan` query-param handling to accept the two new keys
      (used for deep links from paywalls). Minor.

### Acceptance criteria

- `GET /billing/plans` returns the 3 passes plus the 2 subscriptions in
  `PLANS_ORDER` order.
- The billing page renders a Passes section and a Subscriptions section; the
  yearly card shows a computed savings badge versus 12x monthly.
- Purchasing a subscription calls `POST /billing/subscribe { plan: "sub_*" }`,
  which resolves the correct `DODO_PRODUCT_SUB_*` id (or throws
  `dodo_missing_product:...` if the env var is unset, which is expected until
  the human sets it).
- A simulated `subscription.activated` webhook for `sub_monthly` sets
  `Subscription.plan = "sub_monthly"`, `status = "active"`, `tier = "pro"`, and
  a `currentPeriodEnd` 30 days out; `entitlementsFor()` then reports the
  10000/600/120 quotas.
- For `sub_yearly`, `planPeriodKey` produces a month-based key so a new calendar
  month yields a fresh `UsageCounter` window (quotas refresh monthly).
- A simulated `subscription.cancelled` webhook downgrades to free on next
  entitlement resolution.
- `stripe` / `paypal` remain uncompilable (do not touch `types.ts`).

### Tests (backend)

- `plans`: `PLANS`, `PLANS_ORDER`, and `isPaidPlan` include the two new plans
  with correct quotas and prices.
- `period`: `planPeriodKey("sub_yearly", farFutureDate)` changes when the
  current month changes; `planPeriodKey("monthly", expiry)` is unchanged
  behavior.
- `dodo.resolveProductId`: `{ intent: "subscription", plan: "sub_monthly" }`
  reads `DODO_PRODUCT_SUB_MONTHLY`; missing env throws the documented error.
- `webhooks/dodo.normalize`: a `subscription.renewed` event with
  `metadata.plan = "sub_yearly"` normalizes to `subscription.activated` with
  `plan = "sub_yearly"`.
- `webhooks/shared.processSubscriptionEvent`: activating `sub_monthly` grants
  `pro` tier and the correct `currentPeriodEnd`; idempotency still holds on a
  duplicate `(provider, eventId)`.
- `entitlements`: an active `sub_monthly` subscription returns 10000/600/120.

### Tests (frontend)

- Billing page renders a Subscriptions section with both plans and a savings
  badge on yearly (mock `GET /billing/plans`).

---

## Feature 3: Testimonial and review revamp

### Goal

Replace the placeholder reviewer names and copy on the two surfaces that show
testimonials outside the app chrome, using fresh names and positive,
believable, specific ButterCupp copy. Do not add or remove entries; rewrite the
existing ones in place.

### Surfaces (verified, both hardcoded arrays)

1. Landing page: `frontend/components/marketing/SocialProof.tsx`, the
   `TESTIMONIALS` array (2 entries). Each entry has `quote`, `name`, `handle`,
   `role`. Avatars are computed from initials, so changing `name` updates the
   avatar automatically. Keep the 5-star rendering as-is.
2. Billing page: `frontend/app/(protected)/billing/BillingClient.tsx`, the
   `REVIEWS` array (3 entries). Each entry has `title`, `body`, `who` (an
   anonymized initials string like `A***`). Keep the star rendering as-is.

### Changes

- Rewrite all 5 entries. For each: invent a new plausible first-name +
  last-initial style name (landing) or a new anonymized initials string
  (billing `who`), a new handle on landing that matches the new name, and new
  review copy.
- Copy rules: positive and specific about ButterCupp (memory that persists
  across sessions, lifelike voice, quality characters, image generation,
  creative roleplay), believable and varied in voice, no marketing cliches,
  and matched to the current length of each field. No em dash. Do not invent
  fake metrics or claims that could read as deceptive (keep it as personal
  opinion, for example "it feels like ...").
- Keep the `role` field style on landing ("Member since ...") plausible.
- Do not change component structure, styling, star colors, or array length.

### Acceptance criteria

- All 5 names/handles/`who` values differ from the current placeholders.
- All 5 quote/body strings are rewritten and read as positive personal reviews.
- `npm run check:no-em-dash` stays green; eslint passes; no TS changes needed.

### Tests

- Lightweight: existing component tests (if any) still pass. Add a tiny
  assertion that both arrays still have their original lengths (2 and 3) so a
  future edit cannot silently drop entries. No snapshot of copy text (it is
  editorial).

---

## Feature 4: Move reels to the poppy-reels S3 bucket

### Goal

The 65 reel videos currently committed at `frontend/public/reels/1.mp4` ..
`65.mp4` (about 108 MB) must be served from the S3 bucket `poppy-reels` instead
of the repo. After a verified upload, delete the local copies from the repo and
serve reels from S3 through the existing signing/proxy path.

### Current state (verified)

- Local files: `frontend/public/reels/1.mp4` .. `65.mp4`.
- Manifest: `frontend/lib/reels/manifest.ts`, `REELS` array, `src` values are
  local paths like `/reels/1.mp4`.
- Data fetchers: `frontend/lib/reels/data.ts` (`getPublicReels`) and
  `frontend/app/(protected)/reels/page.tsx`. Both prefer DB `CharacterMedia`
  (kind = "video") and fall back to the manifest. They already call
  `signAssetUrl(u)` when a URL is a bare S3 key.
- Signing: `frontend/lib/cdn.ts` `signAssetUrl(s3Key, ttl)` returns a CloudFront
  signed URL if configured, else falls back to the `/api/media?k=<key>` proxy.
- Media proxy: `frontend/app/api/media/route.ts` and
  `frontend/app/api/media/[...key]/route.ts` presign against a bucket chosen by
  key prefix (currently `images/` -> `POPPY_S3_BUCKET_GENERATED`, else
  `S3_BUCKET`).
- Backend bucket routing: `backend/src/media/storage.ts` (`bucketForKey`).
- Bucket + env already declared but unused:
  `Plans/aws-automation/config.env` has `S3_BUCKET_REELS="poppy-reels"` and
  `secrets.env` has `POPPY_S3_BUCKET_REELS=poppy-reels`.
- Upload pattern to copy: `Plans/inference-aws/upload-personas-to-s3.sh`
  (uses `aws s3 sync` with content-type and immutable cache-control).

### Changes

1. **Upload script**: create
   `Plans/inference-aws/upload-reels-to-s3.sh` modeled on
   `upload-personas-to-s3.sh`:
   ```bash
   aws s3 sync frontend/public/reels/ "s3://${POPPY_S3_BUCKET_REELS}/reels/" \
     --region "${AWS_REGION}" \
     --exclude "*.DS_Store" \
     --content-type "video/mp4" \
     --cache-control "public, max-age=31536000, immutable"
   ```
   Support a `DRY_RUN=1` mode that adds `--dryrun`. Read
   `POPPY_S3_BUCKET_REELS` and `AWS_REGION` from the environment and fail with a
   clear message if unset. Do NOT run the real upload as part of implementation;
   a human runs it (see Manual steps). You may run it with `DRY_RUN=1` to prove
   the command resolves.

2. **Manifest** `frontend/lib/reels/manifest.ts`: change every `src` from
   `/reels/<id>.mp4` to the bare S3 key `reels/<id>.mp4` so `signAssetUrl`
   handles it. Leave the avatar fields as they are unless they already follow
   the bare-key convention elsewhere; do not change avatar behavior in this
   feature. Ensure whatever consumes `manifest.src` runs it through
   `signAssetUrl` (the protected page and `data.ts` fallback should sign the
   manifest `src` the same way they sign DB values). Update those two call sites
   if the manifest branch currently returns `src` unsigned.

3. **Frontend media proxy bucket routing**: in
   `frontend/app/api/media/route.ts` and
   `frontend/app/api/media/[...key]/route.ts`, add a prefix rule so keys
   starting with `reels/` presign against `POPPY_S3_BUCKET_REELS`. Keep the
   existing `images/` and default rules.

4. **Backend `bucketForKey`** in `backend/src/media/storage.ts`: add the
   `reels/` -> `POPPY_S3_BUCKET_REELS` branch so any backend signing of reel
   keys targets the right bucket.

5. **Env**: add `POPPY_S3_BUCKET_REELS` to `backend/.env.example` and, if the
   frontend reads bucket names from env, to the frontend env example too. Locally
   default it to `poppy-reels`.

6. **Delete local files**: after the upload is verified (human step), remove
   `frontend/public/reels/*.mp4` from the repo. In this implementation, DELETE
   the files (the user chose "serve from S3 only"), but call it out clearly in
   the summary so the human uploads first. If you want to be safe, gate the
   deletion behind a one-line note in Manual steps; do the code + manifest +
   routing changes now and perform the `git rm` of the mp4s as the final edit so
   the diff is obvious.

7. Grep the repo for any other reference to `/reels/*.mp4` or the public reels
   path and update or remove as needed so nothing points at the deleted files.

### Acceptance criteria

- `frontend/lib/reels/manifest.ts` `src` values are bare `reels/<id>.mp4` keys.
- Both `/api/media` routes and backend `bucketForKey` route `reels/` keys to
  `POPPY_S3_BUCKET_REELS`.
- The protected reels page and the public reels fetcher produce a signed or
  proxied URL for manifest-sourced reels (no raw `/reels/x.mp4` public path in
  the rendered output).
- `frontend/public/reels/*.mp4` no longer exist in the repo after the change.
- `upload-reels-to-s3.sh --dry-run` (or `DRY_RUN=1`) prints the correct
  `aws s3 sync` plan without error.
- No remaining code references the deleted local reel paths.

### Tests

- Unit test the bucket routing helper(s): a `reels/1.mp4` key resolves to
  `POPPY_S3_BUCKET_REELS`; an `images/..` key still resolves to the generated
  bucket; a default key resolves to `S3_BUCKET`.
- A small test (or type-level check) that the manifest `src` values match
  `^reels/\d+\.mp4$`.
- Frontend: reels page renders items whose `src` is a signed/proxied URL, not a
  `/reels/...` public path (mock `signAssetUrl`).

---

## Global sanity (run after all four features)

From the repo root:

```bash
npm install
npm run typecheck
npm run check:no-em-dash
npm run build
npm test
npx eslint .
```

All must pass. Additionally:

- Boot the app locally and manually verify:
  - In-chat: ask a character for a photo; confirm a teaser reply appears, the
    loading skeleton shows, and an image returns. Confirm (via logs) the prompt
    sent to the image provider is the enriched prompt, not the raw command.
  - Billing: the page shows Passes and Subscriptions sections; clicking a
    subscription starts checkout (it will error `dodo_missing_product` until the
    human adds the product ids, which is expected).
  - Reviews: landing and billing show the new copy.
  - Reels: the reels page loads videos from S3-backed URLs.

Do not commit, push, or deploy. Leave the working tree for the human to review.

---

## Manual steps (human, minimal)

1. **Dodo products**: in the Dodo dashboard create two RECURRING subscription
   products (Monthly Subscription $19.99/month, Yearly Subscription $149/year).
   Copy their product ids into the backend env as
   `DODO_PRODUCT_SUB_MONTHLY=...` and `DODO_PRODUCT_SUB_YEARLY=...` (local
   `.env` now; prod secrets at deploy time). Ensure the Dodo webhook is
   subscribed to the `subscription.*` and `payment.*` events (it already is for
   the existing passes).

2. **Reels upload**: ensure the `poppy-reels` S3 bucket exists in the target
   account/region and your AWS credentials can write to it, then run once:
   ```bash
   AWS_REGION=<region> POPPY_S3_BUCKET_REELS=poppy-reels \
     bash Plans/inference-aws/upload-reels-to-s3.sh
   ```
   Verify the 65 objects landed under `s3://poppy-reels/reels/` before relying
   on the deletion of the local copies. Set `POPPY_S3_BUCKET_REELS` in the
   backend and frontend runtime env (local and, at deploy time, prod).

3. **Optional CloudFront**: if you serve reels via CloudFront rather than the
   `/api/media` proxy, add a `reels/*` (or `videos/*`) behavior on the existing
   distribution. Not required; the proxy fallback works without it.
