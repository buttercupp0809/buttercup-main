# Phase 10 - Monetization (subscription tiers + token economy)

## Goal
Deliver ButterCupp's money layer: **subscription tiers** (Free / Premium / Pro) with a feature + limit matrix mirroring Pellow `subscription/tier.ts`; a **`TokenLedger`-based consumable credit** system (images, voice, premium-model messages) with atomic debits/grants reusing the Phase-07 ledger; an **adult-friendly `PaymentProvider` abstraction** (Stripe is NOT usable for mature content -> target CCBill / Verotel / SegPay + optional crypto) with normalized webhooks mirroring Pellow's multi-provider payment pattern; **server-side paywall + usage-limit enforcement** (usage/counter.ts pattern); and a **billing UI** (tier comparison, current status, token balance, buy-tokens, invoice history).

Hard constraint (PRD §0, §12): **mature content never routes to Stripe/PayPal.** The provider abstraction must make that structurally impossible for mature accounts.

Reference: PRD §5.8 (billing), §13 (monetization matrix), §12 (payment constraints), §7.2(5) (token economy divergence).

## Prerequisites
- Phase 07 green: `TokenLedger` atomic `debitTokens` / `refundTokens`, `User.tokenBalance`, `InsufficientTokensError`, `MEDIA_TOKEN_COSTS`.
- Phase 02 green: `User.subscriptionTier`, `Subscription`, `TokenLedger` tables.
- Phase 01 green: cookie JWT auth, `User.contentRating` / mature-gate state (so we can route mature accounts away from Stripe).
- Env: adult-friendly processor keys (`CCBILL_*` / `VEROTEL_*` / `SEGPAY_*`), `PAYMENT_PRIMARY_PROVIDER`, optional crypto (`COINBASE_COMMERCE_*` or similar). No Stripe key in mature-account paths.

## Context to paste into Cursor
```
You are implementing Phase 10 of ButterCupp (see prds/master-prd.md §5.8, §13, §12, §7.2(5)).

Mirror Pellow's structure:
- Tier semantics single source of truth: ../Pellow/backend/src/subscription/tier.ts (helpers isPaidUser/normalizeTier). ButterCupp has THREE tiers: free | premium | pro (Pellow collapsed to free|active; do NOT collapse).
- Per-tier limits: ../Pellow/backend/src/usage/limits.ts (TIER_LIMITS map, -1 = unlimited, getLimitsForTier).
- Server-side enforcement: ../Pellow/backend/src/usage/counter.ts (upsert usage counters, checkUsageLimit -> {allowed,current,limit,period}). Reuse this pattern for daily/monthly caps.
- Multi-provider payments: ../Pellow/frontend/lib/payments/provider.ts (failover chain with health/circuit-breaker), types.ts (CheckoutRequest/Response, NormalizedEvent, NormalizedEventType), webhooks/shared.ts (processSubscriptionEvent with an in-memory processedEvents dedupe set for idempotency).

CRITICAL: ButterCupp is mature-gated. Stripe/PayPal are FORBIDDEN for mature content. Replace Pellow's dodo/creem/stripe adapters with CCBill / Verotel / SegPay (+ optional crypto). A mature account must be structurally unable to reach a Stripe adapter.

Token economy sits ON TOP of tiers: images/voice/premium-model messages consume TokenLedger credits (Phase 07 debit); tiers grant a monthly token allotment + set feature limits. Buy-tokens purchases add credits via a grant ledger entry.
No em dashes. TypeScript strict. Zod on every mutation + webhook body. Server-side enforcement, never trust the client.
```

## Build steps

1. **Tier semantics**: `backend/src/subscription/tier.ts` (mirrors Pellow)
   - `Tier = "free" | "premium" | "pro"`. Helpers: `isPaidUser(tier)`, `isPro(tier)`, `normalizeTier(tier)` (map legacy/unknown -> `free`).

2. **Tier limit + feature matrix**: `backend/src/subscription/limits.ts` (mirrors Pellow `usage/limits.ts`)
   - `TIER_LIMITS: Record<Tier, TierLimits>` from PRD §13: Free (limited daily messages, shallow memory, no voice/image, trickle token grant), Premium (unlimited chat, full memory, included voice/image quota, monthly grant), Pro (unlimited + premium model + priority, higher quotas, larger grant). `-1 = unlimited`.
   - Fields: `dailyMessages`, `premiumModel: boolean`, `memoryDepth`, `voiceEnabled`, `imageEnabled`, `monthlyTokenGrant`, `priority`.
   - `getLimitsForTier(tier)`, `isUnlimited(n)`.

3. **Monthly token grant**: `backend/src/subscription/grant.ts`
   - `grantMonthlyTokens(userId, tier)`: idempotent per billing period; inserts a `TokenLedger` row (`reason: "grant"`, positive delta) via the Phase-07 ledger (atomic), sets `User.tokenBalance`. Called on activation and on each renewal `transaction.completed`.

4. **Server-side paywall + usage enforcement**: `backend/src/subscription/enforce.ts` (mirrors `usage/counter.ts`)
   - `checkUsageLimit(userId, counterType, tier)`: upsert daily/monthly `UsageCounter`, compare against `TIER_LIMITS`; return `{ allowed, current, limit, period }`.
   - `enforceFeature(userId, feature)`: e.g. voice/image/premiumModel gated by tier; returns allow or a paywall reason.
   - `assertCanConsume(userId, kind)`: combines feature gate + token balance; throws a `PaywallError` with a normalized body `{ reason, upgradeUrl, buyTokensUrl }`. Chat/media routes call this BEFORE enqueue (ties into Phase-07 pre-check).
   - All enforcement is server-side; the UI mirrors it but is never the gate.

5. **Payment types + provider abstraction**: `backend/src/payments/types.ts` + `provider.ts` (mirrors Pellow)
   - `PaymentProvider = "ccbill" | "verotel" | "segpay" | "crypto"` (NO stripe/paypal).
   - `CheckoutRequest`, `CheckoutResponse`, `NormalizedEvent`, `NormalizedEventType` (`subscription.created|activated|updated|canceled|past_due`, `transaction.completed|payment_failed`) ported from Pellow `types.ts`.
   - `provider.ts`: `createCheckoutSession(req)` iterates `getProviderOrder()` (from `PAYMENT_PRIMARY_PROVIDER`), skips unconfigured/unhealthy providers (circuit-breaker via a `health.ts` port), returns the first success. `PaymentProviderUnavailableError` on exhaustion.
   - **Mature guard**: `assertMatureCompatibleProvider(user)` throws if any Stripe/PayPal adapter is ever reachable for a mature account. There is no Stripe adapter in this file at all.

6. **Provider adapters**: `backend/src/payments/ccbill.ts`, `verotel.ts`, `segpay.ts`, `crypto.ts`
   - Each exports `{ createCheckout, cancelAtPeriodEnd, getPortalUrl }` + an `isConfigured()` client probe (returns null when its env keys are unset), mirroring Pellow's `dodo.ts` / `creem.ts` adapter shape.
   - Stub the network calls behind the adapter interface so the failover chain + tests work without live processor accounts (adult processors need KYC onboarding, PRD §18).

7. **Webhook normalization + idempotency**: `backend/src/payments/webhooks/{ccbill,verotel,segpay,crypto}.ts` + `shared.ts` (mirrors Pellow `webhooks/shared.ts`)
   - Per-provider: **verify signature** (each processor's HMAC/salt scheme), then normalize to `NormalizedEvent`.
   - `shared.ts` `processSubscriptionEvent(event)`: dedupe via a `processedEvents` set keyed `provider:eventId` (Pellow pattern; back it with a persisted `WebhookEvent` row or Redis SETNX for cross-instance idempotency since ButterCupp runs multiple ECS tasks). On `subscription.activated`/`transaction.completed`: upsert `Subscription`, set `User.subscriptionTier`, `grantMonthlyTokens`. On `canceled`/`past_due`/`payment_failed`: downgrade to `free`.
   - Route: `POST /api/webhooks/[provider]/route.ts` (PRD §9.1) -> verify -> normalize -> `processSubscriptionEvent`. Always return 200 after persistence; side effects fail-soft.

8. **Buy-tokens flow**: `backend/src/payments/tokens.ts` + `POST /api/billing/tokens`
   - Token packs (id -> credits + price). Checkout via the provider chain (one-time charge). On `transaction.completed` for a token pack, insert a `TokenLedger` grant (`reason: "purchase"`) atomically -> `User.tokenBalance` up.
   - `POST /api/billing/subscribe` -> `createCheckoutSession` for a tier.

9. **Billing API**: routes
   - `GET /api/billing/status` -> current tier, period end, token balance, usage vs limits.
   - `GET /api/billing/invoices` -> invoice/transaction history (from `Subscription` + `TokenLedger`).
   - All Zod-validated, auth-guarded.

10. **Billing UI**: `frontend/app/billing/`
    - `TierComparison.tsx`: Free/Premium/Pro matrix from PRD §13 with upgrade CTAs.
    - `CurrentStatus.tsx`: active tier, renewal date, token balance (live-updates after purchase).
    - `BuyTokens.tsx`: token packs -> checkout.
    - `InvoiceHistory.tsx`: past charges.
    - Reuse design tokens + component library (Pellow pattern). No em dashes.
    - Route mature accounts only to adult-processor checkout URLs (never a Stripe URL).

11. **Metrics + audit**: counters for subscribe / token_purchase / paywall_hit / webhook outcome (PRD §16); `audit.ts` on every billing state change.

## Test instructions
```
# Vitest (backend)
npm run test -w backend -- billing
npm run test -w backend -- payments

# Frontend upgrade flow (Playwright, mocked provider)
npm run dev
npm run test:e2e -- billing
```
Vitest cases:
- **tier gating** (`subscription/__tests__/`): `getLimitsForTier` matches PRD §13; `enforceFeature` blocks voice/image/premiumModel on Free; unlimited on Pro.
- **token atomicity** (reuse Phase-07 ledger): debit/grant are atomic; concurrent debits never go negative; a grant increments `balanceAfter` correctly.
- **webhook signature + normalization** (`payments/webhooks/__tests__/`): a tampered signature is rejected; a valid CCBill/Verotel/SegPay payload normalizes to the right `NormalizedEvent`.
- **webhook idempotency**: replaying the same `provider:eventId` applies the effect once (no double grant).
- **paywall**: `assertCanConsume` throws `PaywallError` when out of tokens or feature-gated; body includes `upgradeUrl` + `buyTokensUrl`.
- **mature guard**: no code path lets a mature account reach a Stripe/PayPal adapter (assert the provider order contains only adult processors; `assertMatureCompatibleProvider` throws otherwise).

Playwright: upgrade Free -> Premium via a mocked provider; on webhook, tier flips and monthly tokens are granted; token balance in the UI updates after a buy-tokens purchase.

## Sanity checklist
- [ ] Limits enforced **server-side** (route calls `assertCanConsume` / `checkUsageLimit`), not just hidden in the UI.
- [ ] Webhooks are idempotent: a replayed event does not double-grant tokens or double-flip tier.
- [ ] Webhook signatures verified per provider; tampered payloads rejected.
- [ ] **Mature content never routes to Stripe/PayPal**, there is no Stripe adapter in the mature path, and the provider order is adult-processor-only.
- [ ] Provider failover works: primary down -> fallback processor used; both down -> single user-safe error.
- [ ] Buying tokens increments balance via a `purchase` ledger entry; monthly grant fires on activation/renewal.
- [ ] Billing UI shows correct tier, renewal date, live token balance, and invoice history.

## Done criteria
- Three tiers with a server-enforced feature + limit matrix live.
- Token economy (grants on tier, purchases on packs, consumption via Phase-07 debit) working atomically.
- Adult-friendly multi-provider payments with normalized, idempotent, signature-verified webhooks; Stripe structurally excluded from mature paths.
- Billing UI complete; paywall enforced server-side end to end.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret writes (CCBill/Verotel/SegPay/crypto keys into SSM/Secrets Manager), live-mode webhook endpoint registration, or ECS deploy. Each requires an explicit, fresh, per-action human approval. Local-only work (edits, local tests with mocked processors, local dev server) proceeds without it. Never route real/live payment configuration or processor onboarding without an explicit ask, and prior approval never carries to the next action.
