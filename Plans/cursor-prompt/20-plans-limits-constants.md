# Phase 20 - Daily / Weekly / Monthly plans + limits constants

## Goal
Introduce **duration-pass plans** (Free, Daily $1, Weekly $6, Monthly $25) as the new monetization primitive, backed by a **single source-of-truth constants file** `backend/src/subscription/plans.ts` that the whole system reads for per-plan chat/image/video quotas, price, and duration. Add the two additive Prisma columns the plan model needs (`Subscription.plan`, `User.freeMessagesUsed`). Build an `entitlementsFor(userId)` helper that resolves the active plan and returns remaining chats/images/videos + expiry. Wire plan + `currentPeriodEnd = now + durationDays` on purchase in `grant.ts` and the payment webhooks. Rebuild the billing UI around Daily/Weekly/Monthly cards with live status, remaining quotas, and expiry.

This phase does NOT wire enforcement into the chat/media entry points. That is Phase 21. Phase 20 only lands the constants, schema, entitlement math, purchase wiring, and UI. The `tier` enum (free/premium/pro) and all token-pack behavior are kept for backward compatibility.

Reference: PRD §2.6 (strict monetization + plans block), §3 (data model changes, additive).

## Prerequisites
- Phase 10 green: `backend/src/subscription/{tier,limits,grant,enforce}.ts`, `backend/src/payments/webhooks/shared.ts` (`processSubscriptionEvent`, `grantMonthlyTokens`, `TOKEN_PACKS`), `UsageCounter` model, `TokenLedger` model, `Subscription` model.
- `packages/database` Prisma singleton (`import { prisma } from "@poppy/database"`, never `new PrismaClient()`).
- `backend/src/test-utils/db.ts` (`dbReachable()` -> `DB_UP`) for DB-guarded integration tests.
- Local Postgres up (docker-compose) if you want the DB-backed tests to run rather than skip.

## Context to paste into Cursor
```
You are implementing Phase 20 of Poppy (see prds/experience-monetization-prd.md §2.6, §3).

Poppy is moving from recurring tiers to DURATION PASSES. A user buys a pass that is
valid for N days and grants a fixed number of chats/images/videos for that window.
Free users get a LIFETIME free trial of 10 chats (no media).

SINGLE SOURCE OF TRUTH: backend/src/subscription/plans.ts holds every plan's
priceUsd, durationDays, and chat/image/video quotas. Nothing else hardcodes these
numbers. enforce.ts (Phase 21), the webhooks, and the billing UI all read from here
(the UI via a small entitlements API, never by importing backend code).

ADDITIVE, NON-DESTRUCTIVE schema only:
- User.freeMessagesUsed Int @default(0)   (lifetime free-trial counter)
- Subscription.plan String? (nullable; "free" | "daily" | "weekly" | "monthly")
Keep Subscription.tier (SubscriptionTier enum) and User.subscriptionTier for
back-compat. Keep TOKEN_PACKS and the token-pack purchase path untouched.

Per-plan chat/image/video numbers for DAILY/WEEKLY/MONTHLY are TUNE placeholders the
human sets. Mark them clearly. Do NOT invent final numbers.

No em dashes. TypeScript strict. Zod on any new mutation. Server is the source of truth;
the UI mirrors entitlements it fetches, it never computes quota locally.
```

## Build steps

1. **Plan constants (single source of truth): `backend/src/subscription/plans.ts`** (new)
   - `export type Plan = "free" | "daily" | "weekly" | "monthly";`
   - `export const PLANS_ORDER: Plan[] = ["free", "daily", "weekly", "monthly"];`
   - `export const UNLIMITED = -1;` and `export const isUnlimited = (n: number) => n === UNLIMITED;` (or re-export from `limits.ts` to avoid drift; pick one home and import it in the other).
   - Interface:
     ```ts
     export interface PlanConfig {
       plan: Plan;
       label: string;      // "Free" | "Daily Pass" | ...
       priceUsd: number;   // 0 | 1 | 6 | 25
       durationDays: number; // 0 (lifetime free) | 1 | 7 | 30
       chats: number;      // lifetime for free; per-period for passes; -1 = unlimited
       images: number;
       videos: number;
     }
     ```
   - `export const PLANS: Record<Plan, PlanConfig>`:
     ```
     free:    { priceUsd: 0,  durationDays: 0,  chats: 10, images: 0, videos: 0 }  // 10 lifetime, no media
     daily:   { priceUsd: 1,  durationDays: 1,  chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
     weekly:  { priceUsd: 6,  durationDays: 7,  chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
     monthly: { priceUsd: 25, durationDays: 30, chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
     ```
     Leave each `<TUNE>` as an explicit `0 /* TUNE: set chats/images/videos for this plan */` placeholder with a comment. The human fills these in. `free.chats = 10` (the `FREE_MESSAGE_LIMIT`) is a real default, not a placeholder.
   - `export const FREE_MESSAGE_LIMIT = PLANS.free.chats;` (10). Phase 21 imports this exact constant so the free-trial number lives in ONE place.
   - Helpers:
     - `getPlanConfig(plan: Plan): PlanConfig`
     - `isPaidPlan(plan: Plan): boolean` (`plan !== "free"`)
     - `planExpiryFrom(plan: Plan, from = new Date()): Date | null` -> `from + durationDays` (null for free / durationDays 0).
   - Add a `// PLAN QUOTA TYPE:` note explaining `counterType` maps: `"chat"` -> `chats`, `"image"` -> `images`, `"video"` -> `videos`.

2. **Prisma schema (additive): `packages/database/prisma/schema.prisma`**
   - In `model User`, add:
     ```
     freeMessagesUsed Int @default(0)
     ```
   - In `model Subscription`, add:
     ```
     plan String? // "free" | "daily" | "weekly" | "monthly"; null = never purchased a pass
     ```
   - Keep `tier`, `status`, `currentPeriodEnd`, `externalId` exactly as they are. Both new columns are nullable/defaulted, so the migration is additive and non-destructive.
   - Generate the migration file with `prisma migrate dev --create-only --name add_plan_and_free_messages` so it is reviewable but NOT applied to any non-local DB. Applying it against local dev Postgres is fine; applying to any hosted DB requires explicit human approval (see Guardrail note).
   - Run `prisma generate` so the client types pick up the new fields.

3. **Entitlements resolver: `backend/src/subscription/entitlements.ts`** (new)
   - Purpose: the single function everything else asks "what can this user do right now, and how much is left".
   - Shape:
     ```ts
     export interface Entitlements {
       plan: Plan;                 // active plan; "free" when no active pass
       active: boolean;            // true when a paid pass is active and not expired
       expiresAt: string | null;   // ISO; null for free
       chats:  { limit: number; used: number; remaining: number };
       images: { limit: number; used: number; remaining: number };
       videos: { limit: number; used: number; remaining: number };
       freeMessagesUsed: number;   // lifetime free-trial count (for the paywall UI)
     }
     ```
   - `export async function entitlementsFor(userId: string, now = new Date()): Promise<Entitlements>`:
     1. Load `User.freeMessagesUsed` and the `Subscription` (`plan`, `status`, `currentPeriodEnd`).
     2. Determine the active plan: if `subscription.plan` is a paid plan AND `status === "active"` AND (`currentPeriodEnd == null || currentPeriodEnd > now`) -> that plan is active. Otherwise -> `"free"`.
     3. For the free plan: `chats.limit = FREE_MESSAGE_LIMIT`, `chats.used = user.freeMessagesUsed`, `remaining = max(0, limit - used)`; images/videos limit 0.
     4. For an active paid plan: read the plan's period key (see step 4) and read `UsageCounter` counts for `counterType` in `chat|image|video` at that period; `limit` from `PLANS[plan]`, `remaining = isUnlimited(limit) ? Infinity-safe-sentinel : max(0, limit - used)`. Represent unlimited as `-1` in `limit` and a large/`-1` remaining sentinel the UI understands.
     5. `expiresAt = subscription.currentPeriodEnd?.toISOString() ?? null`.
   - Keep this read-only. It never increments. Increment is Phase 21 (on successful reply / media).

4. **Plan period key: `backend/src/subscription/period.ts`** (new, small)
   - `export function planPeriodKey(plan: Plan, currentPeriodEnd: Date | null): string` -> a stable string that identifies the current pass window so `UsageCounter.period` is unique per purchase window. Recommended: `` `${plan}:${currentPeriodEnd ? currentPeriodEnd.toISOString().slice(0,10) : "none"}` `` (the expiry date pins the window; a new purchase produces a new expiry -> a fresh counter, so quotas reset per pass). Free plan chat is NOT counted here (it uses `User.freeMessagesUsed`), so `planPeriodKey` is only for paid plans.
   - Export a matching `counterTypeFor(kind: "chat" | "image" | "video"): string` if you want to keep counter-type strings centralized. Note: this introduces new `counterType` values `"chat" | "image" | "video"` (plan-scoped) that coexist with Phase 10's legacy `"chat_daily" | "image_daily" | "voice_daily"`. Do not remove the legacy ones.

5. **Grant / purchase wiring: `backend/src/subscription/grant.ts`**
   - Add `export async function activatePlan(userId: string, plan: Plan, from = new Date()): Promise<void>` that:
     - Computes `currentPeriodEnd = planExpiryFrom(plan, from)`.
     - Upserts `Subscription` setting `plan`, `status: "active"`, `currentPeriodEnd`, and (for back-compat) a mapped `tier` (map: `daily|weekly -> premium`, `monthly -> pro`, or keep `premium` for all paid passes; pick one and document it so `tier`-based code still behaves).
     - Leaves `grantMonthlyTokens` intact; if a plan should also grant tokens, call it here, but the plan quotas are the primary gate now.
   - Keep the existing `grantMonthlyTokens` function unchanged (token-pack + tier grants still work).

6. **Webhook wiring: `backend/src/payments/webhooks/shared.ts`**
   - Extend `NormalizedEvent` handling: the checkout for a pass carries which plan was bought. Add an optional `plan?: Plan` to `NormalizedEvent` in `backend/src/payments/types.ts` (additive; keep `tier` and `tokenPackId`).
   - In `processSubscriptionEvent`, on `subscription.activated | subscription.created | subscription.updated` and `transaction.completed` for a plan pass: call `activatePlan(ev.userId, ev.plan, now)` so `Subscription.plan` + `currentPeriodEnd = now + durationDays` are set. If `ev.plan` is absent, fall back to the existing tier path (back-compat), do NOT crash.
   - Keep the token-pack branch (`t === "transaction.completed" && ev.tokenPackId`) exactly as-is: token packs still add credits via `refundTokens` with `reason: "purchase"`.
   - Keep the downgrade branch (`canceled | past_due | payment_failed`) and additionally set `Subscription.plan = "free"` / leave `currentPeriodEnd` in the past so `entitlementsFor` resolves to free.

7. **Entitlements API for the UI: `backend/src/http/billing.ts`** (extend the existing billing status route, or add one)
   - `GET /billing/entitlements` -> `entitlementsFor(userId)` (auth-guarded). The frontend reads this for the current plan card, remaining quotas, and expiry. Do NOT expose raw `plans.ts` numbers through anything except this resolved shape (keeps the UI honest and server-driven).
   - `GET /billing/plans` -> the public plan catalog (label, priceUsd, durationDays, chats/images/videos) so the UI can render the three cards without hardcoding prices. This is derived from `PLANS`.
   - Add `POST /billing/subscribe` support for `{ plan: "daily" | "weekly" | "monthly" }` (in addition to the existing tier-based body, for back-compat) that creates a checkout via the existing provider chain.

8. **Billing UI: `frontend/app/(protected)/billing/BillingClient.tsx`**
   - Replace the `TIERS` array (`free/premium/pro` at $0/$14.99/$29.99) with **plan cards fetched from `GET /billing/plans`**: Daily $1 / Weekly $6 / Monthly $25 (+ a Free row for context). Each card shows price, duration ("1 day" / "7 days" / "30 days"), and chats/images/videos.
   - Add a **current-plan status panel** driven by `GET /billing/entitlements`: active plan label, `expiresAt` (formatted), and three remaining-quota meters (chats / images / videos) with `remaining / limit` (render `Unlimited` when `limit === -1`). For a free user show `10 - freeMessagesUsed` chats remaining and "No media on Free".
   - "Continue" on a card -> `POST /billing/subscribe` with `{ plan }` -> redirect to `checkoutUrl` (reuse the existing `post()` + redirect flow already in this file).
   - Keep the token-pack section (`PACKS`) and its buy flow unchanged.
   - No em dashes. Keep accessibility (labelled meters, button focus states).

## Test instructions
```
# Vitest (backend)
npm run test -w backend -- plans
npm run test -w backend -- entitlements
npm run test -w backend -- webhooks

# Frontend billing render (Playwright, mocked entitlements API)
npm run dev
npm run test:e2e -- billing
```
Vitest cases:
- **plan config integrity** (`subscription/__tests__/plans.test.ts`): every `Plan` has an entry; `priceUsd`/`durationDays` match the PRD (0/0, 1/1, 6/7, 25/30); `FREE_MESSAGE_LIMIT === 10`; `PLANS_ORDER` covers all plans; `isPaidPlan` true for daily/weekly/monthly and false for free; TUNE placeholders are numbers (test does not assert their value, just the type/shape so it passes before tuning).
- **entitlementsFor math** (`subscription/__tests__/entitlements.test.ts`, DB-guarded with `describe.skipIf(!DB_UP)`):
  - fresh free user -> `chats.remaining === 10`, images/videos 0, `active === false`.
  - free user with `freeMessagesUsed = 10` -> `chats.remaining === 0`.
  - user with an active daily pass -> chats/images/videos remaining equal the plan quotas minus any `UsageCounter` counts; `active === true`; `expiresAt` non-null.
  - expired pass (`currentPeriodEnd` in the past) -> resolves back to free.
- **planExpiryFrom / period key**: `planExpiryFrom("weekly", t)` is `t + 7d`; free returns null; `planPeriodKey` is stable within a window and changes when `currentPeriodEnd` changes.
- **webhook sets plan + expiry** (`payments/webhooks/__tests__`, DB-guarded): a `subscription.activated` event with `plan: "monthly"` sets `Subscription.plan = "monthly"` and `currentPeriodEnd ~ now + 30d`; a token-pack `transaction.completed` still grants credits and does NOT touch `plan`.

Playwright: billing page renders three plan cards with correct prices and shows the current-plan status panel with remaining quotas from the mocked `/billing/entitlements`.

## Sanity checklist
- [ ] `backend/src/subscription/plans.ts` is the ONLY place chat/image/video/price/duration numbers live; nothing else hardcodes them.
- [ ] `free` plan is 10 lifetime chats, 0 images, 0 videos; daily/weekly/monthly numbers are clearly marked TUNE placeholders.
- [ ] Migration is additive: `User.freeMessagesUsed` and `Subscription.plan` only; no column dropped or retyped; `tier` enum kept.
- [ ] `entitlementsFor` returns correct remaining for free (10 then 0), for an active pass (quota minus usage), and resolves an expired pass back to free.
- [ ] Purchase sets `Subscription.plan` and `currentPeriodEnd = now + durationDays`; free path is the fallback when no plan on the event.
- [ ] Existing token-pack purchases still add credits (reason `purchase`) with no plan side effects.
- [ ] Billing UI shows Daily/Weekly/Monthly cards + current plan + remaining quotas + expiry, all fetched from the server.

## Done criteria
- Plan constants file live and imported by grant/webhooks/entitlements; UI reads plans + entitlements from the API.
- Additive migration created (and applied locally only); Prisma client regenerated.
- `entitlementsFor` correct for free, active pass, and expired pass, with tests green (or cleanly skipped when no DB).
- Purchases set plan + expiry; token packs and the tier enum still work (no regression).

## Guardrail note
STOP before any commit, push, **non-local DB migration** (this phase creates a Prisma migration that adds `User.freeMessagesUsed` and `Subscription.plan`, applying it to any hosted/prod database requires explicit, fresh, per-action human approval), secret writes, live-mode webhook registration, or ECS/Amplify deploy. Local work (edits, local Postgres migrate, local tests, local dev server) proceeds without it. Prior approval never carries to the next action.
