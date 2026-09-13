# Free-tier photo paywall (blurred teaser to pay to unlock)

Date: 2026-09-10
Status: Approved design, pending implementation plan.

## Goal

Turn every free-user in-chat photo request into a monetization surface. The
photo is generated for real and stored to S3, but a free user sees only a
blurred teaser in the chat bubble with a character-voiced call to action to
pay. On payment, every past and future photo unlocks. Paid users are
unaffected: their photos render clear at the moment of generation, exactly as
today.

## Decisions (locked with product owner)

1. Free taste = ZERO. Blur from photo #1. No free clear image.
2. Generate a real image on every free ask, subject to a safety ceiling.
3. Safety ceiling = 25 real teaser generations per free user per UTC day.
   Above the cap, re-serve an existing locked teaser (no new GPU spend).
4. Unlock scope on payment = ALL past teasers plus all future photos.
5. The blur happens in the chat bubble itself, not only on modal click.
6. The real full-resolution image must never reach a free user's browser.

## Core mechanic: lock state is computed, not stored

A photo is "locked" for a viewer if and only if that viewer is currently free
(`entitlements.active === false`). There is no `locked` column and no backfill.

Consequences:

- Retroactive unlock is automatic. When the payment webhook flips the
  subscription to active, the very next render computes `locked = false` for
  every one of that user's image assets.
- No migration to mark historical assets.
- The lock decision lives in exactly one place per surface (delivery + bytes
  endpoint), driven by the existing `entitlementsFor(userId)` resolver.

## Current-state facts this design depends on

- On-demand images: `backend/src/http/media.ts` `POST /media/image` calls
  `assertCanConsumeMedia(userId, "image")` which throws `PaywallError(402)` for
  any non-active user BEFORE enqueue.
- In-chat images: gated by `assertCanImage(userId)` in
  `backend/src/subscription/enforce.ts` (free = 2 lifetime today).
- `entitlementsFor(userId)` in `backend/src/subscription/entitlements.ts`
  returns `{ active, images: {limit, used, remaining}, ... }`.
- The media worker `backend/src/queue/media-worker.ts` debits tokens via
  `debitTokens()` (aborts with `insufficient_tokens` if balance too low),
  uploads to S3, marks `MediaAsset.status = ready`, dual-writes
  `CharacterMedia`, then WS-notifies the frontend with a presigned URL of the
  form `/api/media?k=<s3Key>`.
- Free users default to `tokenBalance = 0`.
- Server-side blur already exists: `frontend/lib/media-blur.ts`
  `blurredDataUri(src)` downscales to 32x48, blurs, returns a base64 data URI.
- `frontend/components/chat/ImageMessage.tsx` renders image messages and today
  only applies blur inside `UpgradeModal` on click (`imageBlurred={false}`
  currently).

## Behavior changes

### 1. Free users may generate teaser photos

Introduce a teaser-allow path for the in-chat photo flow:

- New guard `assertCanTease(userId)` in `enforce.ts`. It never 402s while the
  user is under the daily teaser cap. It reads/increments a new
  `UsageCounter` of type `free_teaser_image`, period = UTC day, cap = 25.
  - Under cap: allow a real generation.
  - At/over cap: signal "reuse existing teaser" (no new job). The caller
    picks the user's most recent ready image `MediaAsset` for that character
    and delivers it as a locked teaser.
- Paid users keep going through `assertCanConsumeMedia` / `assertCanImage`
  and the plan quota. This path is only for free users.

### 2. Free teaser jobs skip billing

- Enqueue free teaser jobs with `tokenCost: 0` and a `billing: "free_teaser"`
  discriminator on `MediaJobData` (`backend/src/queue/media-queue.ts`).
- In `media-worker.ts`, when `billing === "free_teaser"`: skip `debitTokens`
  and skip `consumePlanQuota`. Everything else (render, S3 upload, status,
  CharacterMedia dual-write, WS notify) is unchanged.
- Rationale: free users have 0 tokens; without this they would fail with
  `insufficient_tokens`.

### 3. Secure, lock-aware delivery

Two surfaces deliver image URLs to the browser; both branch on the viewer's
entitlement.

- Hard boundary: the frontend bytes route `frontend/app/api/media/route.ts`
  (`/api/media?k=<s3Key>`). New rule: if the requester is free AND the asset is
  an image the requester owns, serve the blurred bytes (from `blurredDataUri`)
  rather than the full-resolution presigned stream. A leaked `s3Key` therefore
  cannot exfiltrate the clear image.
- Payload shaping: the chat-history loader and the WS "media ready" notify
  build message payloads. For a free viewer the image message carries
  `{ locked: true, blurUri: <inline base64>, ctaText }` and NO real key or url.
  For a paid viewer it carries the real presigned url as today. This is both a
  UX affordance (bubble shows the blur immediately) and defense in depth.

### 4. Chat bubble renders the blur inline

- `ImageMessage.tsx`: when the message is `locked`, render the inline
  `blurUri` in the bubble with a character-voiced CTA overlay and an "Unlock"
  affordance. Tapping anywhere opens the existing `UpgradeModal` routed to
  `/billing`. When not locked, render the clear image as today.

### 5. CTA copy

- New copy module with a small curated, rotating set of character-flavored
  lines interpolated with `{characterName}` (for example: "I made this just
  for you... unlock me", "I'm still waiting for you to see it"). Static, no LLM
  call (no latency or cost). Selection can be deterministic per `mediaAssetId`
  so a given teaser keeps a stable line.

### 6. Unlock on payment

No new work. The existing payment webhook flips the subscription to active;
the next render computes `locked = false`, so `/api/media` serves full-res and
payloads carry real urls. Past teasers unblur; new photos render clear
instantly.

## Data model

- No new tables. One new `UsageCounter` counter type value
  `free_teaser_image` (period = UTC day) reusing the existing composite key
  `(userId, counterType, period)`.
- `MediaJobData` gains an optional `billing?: "free_teaser"` discriminator.

## Error handling

- Generation failure: unchanged. Token refund is a no-op when `tokenCost` is 0.
- Blur failure: `blurredDataUri` already returns a safe fallback data URI.
- Over-cap: fall back to an existing ready teaser rather than erroring; if the
  user has no prior teaser for that character, allow one generation regardless
  (so the first ask is never a dead end).

## Testing

- Unit:
  - entitlement to lock mapping (free -> locked, active -> unlocked).
  - `/api/media` denies full-res to a free owner of an image asset and returns
    blurred bytes instead.
  - `assertCanTease` cap counter: allows under 25/day, signals reuse at/over.
  - worker skips `debitTokens` and `consumePlanQuota` when
    `billing === "free_teaser"`.
  - CTA line selection is stable per `mediaAssetId`.
- Integration:
  - free ask -> asset ready -> chat payload has `locked:true` + `blurUri`, no
    real key -> simulate payment (flip subscription active) -> same asset now
    delivers a real presigned url.
- E2E (Playwright, baseURL http://localhost:3000):
  - free user asks for a photo, sees a blurred bubble with CTA; after a
    simulated upgrade, the same bubble renders clear.

## Files touched

- `backend/src/subscription/enforce.ts` (new `assertCanTease`)
- `backend/src/subscription/entitlements.ts` (expose teaser counter if needed)
- `backend/src/http/media.ts` (route free photo asks to the teaser path)
- `backend/src/queue/media-queue.ts` (`billing` discriminator, `tokenCost:0`)
- `backend/src/queue/media-worker.ts` (skip billing for free_teaser)
- `frontend/app/api/media/route.ts` (serve blurred bytes to free owner)
- chat-history loader + WS media-ready notify (lock-aware payload shaping)
- `frontend/components/chat/ImageMessage.tsx` (inline blurred bubble + CTA)
- new CTA copy module

## Out of scope

- Any change to paid-user image behavior.
- Any change to the video pipeline.
- LLM-generated CTA copy.
