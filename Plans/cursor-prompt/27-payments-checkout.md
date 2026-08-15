# Phase 27: Payments Checkout + Token Store

## Goal
Finish the payments integration that Phases 10 / 20 / 21 scaffolded. The
backend already has the whole spine: an adult-only provider chain
(`backend/src/payments/provider.ts`), four adapters (CCBill, Verotel, SegPay,
crypto), signature-verifying webhooks (`webhooks/{ccbill,verotel,segpay}.ts`)
that normalize to `NormalizedEvent`, a cross-instance idempotent processor
(`webhooks/shared.ts` -> `WebhookEvent` unique `(provider, eventId)`), the
`plans.ts` single source of truth, `entitlementsFor`, and strict server-side
gates (`enforce.ts` `assertCanChat` / `assertCanConsumeMedia` /
`recordChatConsumption`). The `ForbiddenProviders` type in
`backend/src/payments/types.ts` makes Stripe/PayPal a compile error, so a
processor is NOT being chosen from scratch here.

What is still MISSING and what this phase delivers:
1. A **checkout / upgrade UI**: keep the existing
   `frontend/app/(protected)/billing/` surface but drive its plan cards from
   `GET /billing/plans` (not the hardcoded INR `SUB_PLANS`), and add a
   thin `/upgrade` entry that renders the same surface. Add a reusable
   **paywall CTA modal** (`PaywallModal.tsx`) the chat screen opens on a
   `paywall` event, each card "Continue" -> `POST /billing/subscribe { plan }`
   -> redirect to the provider's hosted `checkoutUrl`.
2. A **token store UI** (`TokenStore.tsx`) that lists `TOKEN_PACKS`, calls
   `POST /billing/tokens { packId }`, redirects to hosted checkout, and shows
   the live balance; the actual credit is written through the `TokenLedger`
   by the webhook (`transaction.completed` + `tokenPackId` ->
   `refundTokens(reason:"purchase")`), never by the client.
3. **End-to-end enforcement wiring** so entitlements/limits (daily messages,
   voice, image, premium model) reflect the ACTIVE `Subscription` + token
   balance. Fix the drift where `frontend/app/api/billing/status/route.ts`
   inlines a stale `TIER_LIMITS` map: the status route must report the same
   plan/entitlement truth the server enforces.
4. **Webhook activation verification**: prove provider webhook ->
   `WebhookEvent` dedup -> `Subscription.status`/`plan`/`currentPeriodEnd`
   update -> entitlement change, and that a replay is a no-op.
5. A **processor recommendation** (below) comparing the existing adult-friendly
   adapters and naming a primary + fallback for an AI-companion subscription.

Provider **hosted** checkout only. No raw card data ever touches the app. Local
+ sandbox/test-mode only; no live keys, no live webhook registration.

Reference: PRD §5.8 (billing), §12 (payment constraints: mature content never
routes to Stripe/PayPal), §13 (monetization matrix), §2.6 (strict enforcement).
Completes Phase 10 (tiers + token economy), Phase 20 (duration passes +
entitlements), Phase 21 (strict paywall gates).

## Prerequisites
- Phase 10 green: `backend/src/payments/{types,provider,ccbill,verotel,segpay,crypto}.ts`, `webhooks/{ccbill,verotel,segpay,shared}.ts`, `TOKEN_PACKS`, `TokenLedger`, `Subscription`, `UsageCounter`, `WebhookEvent` models.
- Phase 20 green: `backend/src/subscription/{plans,entitlements,period,grant}.ts`; `Subscription.plan` + `User.freeMessagesUsed` columns; `GET /billing/plans`, `GET /billing/entitlements`, `POST /billing/subscribe`, `POST /billing/tokens` in `backend/src/http/billing.ts`.
- Phase 21 green: `backend/src/subscription/enforce.ts` (`assertCanChat`, `assertCanConsumeMedia`, `consumeFreeMessage`, `consumePlanQuota`, `recordChatConsumption`, `PaywallError`, `paywallBody`); the WS/SSE `paywall` frame in `packages/shared`.
- Frontend: `frontend/app/(protected)/billing/{page,BillingClient}.tsx` (currently renders hardcoded INR `SUB_PLANS`), `frontend/app/api/billing/{status,invoices}/route.ts`, the billing `post()` + redirect pattern, the design tokens (`--buttercupp-*` CSS vars).
- `packages/database` Prisma singleton (`import { prisma } from "@buttercupp/database"`, never `new PrismaClient()`).
- `backend/src/test-utils/db.ts` (`dbReachable()` -> `DB_UP`) for DB-guarded tests; Playwright under `e2e/` (baseURL `http://localhost:3000`).
- Sandbox env only: `PAYMENT_PRIMARY_PROVIDER`, plus whichever of `CCBILL_*` / `VEROTEL_*` / `SEGPAY_*` / `COINBASE_COMMERCE_*` sandbox keys you want the chain to pick up. Adapters return null from `isConfigured()` when their keys are unset, so an unconfigured provider is simply skipped.

## Processor recommendation

All four adapters already exist; the question is which to make `PAYMENT_PRIMARY_PROVIDER` and which is the fallback for an adult AI-companion **subscription** (recurring duration passes + one-time token packs). Criteria that matter for this product: approval odds for AI/companion + adult content, rolling reserve severity, chargeback tooling (companion apps see high friendly-fraud), native recurring/rebill support, payout cadence, and integration effort against the adapter interface we already have.

| Processor | Adult approval odds | Rolling reserve | Chargeback tooling | Recurring / rebill | Payout terms | Integration effort (given our adapter) | Verdict |
|---|---|---|---|---|---|---|---|
| CCBill | High. Long-standing adult acquirer, explicitly supports companion/AI adjacent merchants. | Moderate (often 5-10% held ~6 months on new accounts). | Strong: built-in chargeback management, integrates Ethoca/Verifi, cascade billing. | First-class (DataLink recurring, cascade to backup biller). | Net weekly/bi-weekly after reserve. | Low: `ccbill.ts` + DataLink digest webhook already done. | **Primary.** Best approval + rebill + chargeback story. |
| SegPay | High. Adult-friendly acquirer, EU + US, good for content subs. | Moderate (comparable to CCBill; negotiable). | Good: postback + dispute handling, 3DS. | Yes (recurring billing, rebill postbacks). | Net weekly/bi-weekly. | Low: `segpay.ts` + HMAC-SHA1 postback already done. | **Fallback.** Independent acquirer so a CCBill outage or account issue does not take checkout down. |
| Verotel / FlexPay | Medium-high. EU-centric (Netherlands), strong for adult but US card approval can lag CCBill. | Moderate. | Adequate: FlexPay handles rebills + refunds; fewer prevention integrations than CCBill. | Yes (FlexPay recurring). | Net terms, EU-oriented. | Low: `verotel.ts` + SHA-256 sig already done. | Secondary fallback / EU-heavy traffic. |
| Crypto (Coinbase Commerce or similar) | N/A (no card acquiring, no approval gate). | None (no reserve). | None: crypto is irreversible, so zero chargeback risk but also zero buyer protection and higher checkout friction. | Weak: hosted crypto checkout is one-shot; recurring passes need app-side renewal prompts, not true rebill. | On-chain settlement, then off-ramp. | Adapter exists but **no webhook handler yet** (see build step 6); one-time token packs only. | **Optional add-on** for token packs / privacy-sensitive users; not the subscription primary. |

**Recommendation:** set `PAYMENT_PRIMARY_PROVIDER=ccbill` with **SegPay** as the automatic fallback in the chain, Verotel as the third link, and crypto offered as an explicit alternative for one-time token packs only (it cannot cleanly rebill a recurring pass). CCBill wins on adult approval odds, native cascade/recurring billing, and the strongest chargeback prevention (Ethoca/Verifi), which matters most for a companion product where friendly fraud is common. SegPay is a genuinely independent acquirer, so keeping it as fallback protects checkout uptime if a single CCBill account is flagged. Do NOT wire crypto as a subscription primary: hosted crypto checkout does not rebill and adds conversion friction.

## Context to paste into Cursor
```
You are implementing Phase 27 of ButterCupp (see prds/master-prd.md §5.8, §12,
§13 and prds/experience-monetization-prd.md §2.6). This COMPLETES the payments
work started in Phases 10 / 20 / 21. The backend spine already exists; do NOT
re-scaffold it and do NOT pick a new processor.

WHAT EXISTS (reuse, do not rewrite):
- backend/src/payments/provider.ts     (adult-only failover chain, circuit breaker)
- backend/src/payments/types.ts        (ForbiddenProviders makes stripe/paypal a COMPILE ERROR)
- backend/src/payments/{ccbill,verotel,segpay,crypto}.ts (hosted-checkout adapters, isConfigured())
- backend/src/payments/webhooks/{ccbill,verotel,segpay}.ts (verifySignature + normalize -> NormalizedEvent)
- backend/src/payments/webhooks/shared.ts (processSubscriptionEvent, recordEvent -> WebhookEvent dedup, TOKEN_PACKS, refundTokens on token-pack completion)
- backend/src/subscription/{plans,entitlements,period,grant,enforce}.ts
- backend/src/http/billing.ts          (POST /billing/subscribe, POST /billing/tokens, GET /billing/entitlements, GET /billing/plans, POST /webhooks/:provider)
- frontend/app/(protected)/billing/{page,BillingClient}.tsx (hardcoded INR SUB_PLANS today)
- frontend/app/api/billing/status/route.ts (inlines a STALE TIER_LIMITS map -> fix the drift)

WHAT TO BUILD:
1. Drive the billing plan cards from GET /billing/plans (not hardcoded numbers);
   add a thin /upgrade route that renders the same surface.
2. A reusable PaywallModal that the chat screen opens on a `paywall` event;
   each plan Continue -> POST /billing/subscribe { plan } -> redirect to the
   provider hosted checkoutUrl.
3. A TokenStore UI that lists TOKEN_PACKS -> POST /billing/tokens { packId } ->
   redirect to hosted checkout. Credits land via the webhook + TokenLedger, NOT
   the client. Show live balance from GET /billing/status.
4. Make GET /billing/status entitlement-truthful (stop inlining a stale matrix);
   report the active plan/tier, currentPeriodEnd, token balance, and the
   voice/image/premiumModel grid the server actually enforces.
5. Verify webhook activation end to end and add the missing crypto webhook route
   (token packs only) mirroring the existing per-provider handlers.

HARD RULES:
- Adult-gated: mature content NEVER routes to Stripe/PayPal. There is no Stripe
  adapter; do not add one. The provider order is adult-processors only.
- Provider HOSTED checkout ONLY. No raw card fields, no card data in-app, no
  Elements. The app only ever redirects to a provider-hosted URL.
- Server is the source of truth. The UI mirrors entitlements it fetches; it
  never computes quota, price, or grants locally.
- Zod-validate every mutation body AND every webhook body at the trust boundary.
  Never trust req.body shape from types alone.
- No em dashes. TypeScript strict; no `any` without a justifying comment.
- Local + sandbox/test-mode only. No live keys, no live webhook registration, no
  secret rotation. STOP and ask before anything prod-touching.
```

## Build steps

1. **Server-truthful billing status: `frontend/app/api/billing/status/route.ts`**
   - Today this route inlines a `TIER_LIMITS` map (`free: 30 daily msgs`, premium/pro unlimited + voice/image) that has drifted from the backend `plans.ts` / `enforce.ts` truth. Replace the inline matrix so the status the UI reads matches what the server enforces.
   - Fetch entitlements from the backend the same way the client does elsewhere: proxy `GET {BACKEND_URL}/billing/entitlements` (forwarding the auth cookie) and also read `User.tokenBalance` + `Subscription` via the `prisma` singleton. Return a single shape: `{ plan, tier, status, currentPeriodEnd, tokenBalance, entitlements: { chats, images, videos }, grants: { voice, image, premiumModel } }`.
   - Derive `grants` from the resolved entitlements (`images.limit !== 0` -> image enabled, etc.) and the tier map, NOT from a second hardcoded copy. Keep exactly one source of the numbers: the backend. Do not re-inline plan quotas in the route.
   - Zod-parse the entitlements response before returning it (never trust the upstream JSON shape by type assertion alone).

2. **Plan-driven upgrade surface: `frontend/app/(protected)/billing/BillingClient.tsx`**
   - Replace the hardcoded `SUB_PLANS` array (fixed 12/3/1-month INR tiles) with cards fetched from `GET /billing/plans` (label, `priceUsd`, `durationDays`, chats/images/videos). Render one card per paid plan (`daily`/`weekly`/`monthly`) plus a Free context row. Prices/quotas come only from the API; nothing hardcoded.
   - Keep the existing `post()` + `window.location.href = checkoutUrl` redirect flow for "Continue" -> `POST /billing/subscribe { plan }`.
   - Add a **current-plan status panel** driven by `GET /billing/entitlements` (or the status route from step 1): active plan label, formatted `expiresAt`, and remaining chats/images/videos (`Unlimited` when `limit === -1`; for free show `10 - freeMessagesUsed` and "No media on Free"). Reuse the existing `--buttercupp-*` tokens. No em dashes; keep labelled meters + focus states.
   - Keep the reviews / benefits presentation blocks; only the numbers move to the API.

3. **Thin upgrade entry: `frontend/app/(protected)/upgrade/page.tsx`** (new, small)
   - A route that renders the same `BillingClient` surface (or a focused subset) so `/upgrade` (used by `paywallBody.upgradeUrl = "/billing?upgrade=1"` and CTAs) resolves to a real page. Read the optional `?plan=` query to pre-highlight a card. This is a light wrapper; do not duplicate the plan-card logic (import `BillingClient` or a shared `PlanCards` component). Server Component shell + the existing client island.

4. **Paywall CTA modal: `frontend/app/(protected)/chat/PaywallModal.tsx`** (new)
   - Renders the plan options from the incoming `paywall` event's `plans` array (Phase 21 already sends the catalog on the frame) with a fallback to `GET /billing/plans`. Copy is scope-aware: free-trial exhausted vs plan-quota used up vs media (image/video) requires-a-plan, keyed off `event.scope` + `event.kind`.
   - Each plan "Continue" -> `POST /billing/subscribe { plan }` -> redirect to `checkoutUrl` (reuse the billing `post()` helper). A separate "Buy tokens instead" affordance opens the token store (step 5) for the media/token path.
   - Blocking modal: disables the chat input while open (the chat screen already sets a `paywalled` state on the `paywall` frame from Phase 21; this component is the visual). Provide `role="dialog"`, focus trap, ESC to dismiss to a read-only chat (input stays disabled until entitlement flips).
   - **Resume flow**: after returning from hosted checkout, poll `GET /billing/entitlements` on a bounded interval until `active === true` (the webhook has landed), then clear `paywalled` and re-enable input. Never re-enable off a client counter; only the server entitlement flip re-enables. (This matches Phase 21 step 7; wire the modal into that existing handler rather than adding a second one.)

5. **Token store UI: `frontend/app/(protected)/billing/TokenStore.tsx`** (new) + mount in `BillingClient`**
   - Fetch the pack catalog. Preferred: add `GET /billing/token-packs` to `backend/src/http/billing.ts` returning `TOKEN_PACKS` (id, credits, label, and a display price) so the UI does not hardcode credits/prices; if you keep prices server-side only, at minimum return credits + label. Render one tile per pack.
   - "Buy" -> `POST /billing/tokens { packId }` (already exists) -> redirect to hosted `checkoutUrl`. On return, poll `GET /billing/status` until `tokenBalance` increases (the webhook wrote the `TokenLedger` `purchase` entry), then update the displayed balance. The client NEVER writes the ledger; it only reads the resulting balance.
   - Show the current token balance prominently (from `GET /billing/status`, step 1). No em dashes; labelled tiles; disabled state while redirecting.

6. **Crypto webhook route (token packs): `backend/src/payments/webhooks/crypto.ts`** (new) + wire in `backend/src/http/billing.ts`**
   - The crypto adapter exists (`crypto.ts`) but there is no `webhooks/crypto.ts`, so a crypto token-pack purchase never activates. Add a handler mirroring the SegPay shape: `verifySignature(rawBody, header)` using the Coinbase Commerce webhook shared-secret (`COINBASE_COMMERCE_WEBHOOK_SECRET`, HMAC-SHA256 over the raw body, timing-safe compare, return false when the secret is unset) and `normalize(payload)` -> `NormalizedEvent` mapping `charge:confirmed`/`charge:resolved` -> `transaction.completed` and carrying `tokenPackId` + `userId` from the charge metadata. Crypto is one-time token packs only; do NOT map it to `subscription.activated` (hosted crypto checkout does not rebill).
   - In `handleWebhook` add a `crypto` branch and extend the route regex `/^\/webhooks\/(ccbill|verotel|segpay|crypto)\/?$/`. Keep the "verify signature -> normalize -> `processSubscriptionEvent` -> always 200 after persistence" contract identical to the other providers.
   - **Zod**: parse the raw webhook body into a schema before `normalize` (all four handlers should validate shape at the boundary; do not `as never`-cast untrusted bodies). Add a Zod schema per provider payload; reject with 400 on a shape mismatch, 401 on a bad signature.

7. **Enforcement wiring verification (no new gates, confirm the chain): `backend/src/http/billing.ts`, `enforce.ts`, `entitlements.ts`**
   - Confirm the end-to-end chain is intact after the UI/status changes: `Subscription` (plan/status/currentPeriodEnd) + `User.tokenBalance` -> `entitlementsFor` -> `assertCanChat` / `assertCanConsumeMedia` (Phase 21 gates) -> `GET /billing/status` + `GET /billing/entitlements` -> UI. If step 1 changed the status shape, update any consumer (billing page, chat header balance) to the new shape.
   - Confirm `recordChatConsumption` still increments the right counter (free -> `User.freeMessagesUsed`; active plan -> `UsageCounter` at `planPeriodKey`) and that a downgrade webhook (`canceled`/`past_due`/`payment_failed`) sets `plan:"free"` so `entitlementsFor` resolves to free and the next `assertCanChat` re-gates. This is verification + glue, not new gating logic.
   - Do NOT change plan numbers, scoring, or the gate thresholds. Do NOT add a Stripe path.

8. **Sandbox notes + env docs (no secrets): `backend/.env.example` (append) + a short `## Sandbox` note in the billing README if one exists**
   - Document the sandbox/test-mode variables (`PAYMENT_PRIMARY_PROVIDER`, the `*_SANDBOX`/test keys, webhook secrets) as EMPTY placeholders with a comment that real keys are set out of band and require approval. Never commit a real key. The adapters already no-op when keys are unset, so local dev + tests run with a mocked/stubbed provider.

## Test instructions
```
# Vitest (backend, entitlement + enforcement + webhook dedup)
npm run test -w backend -- enforce
npm run test -w backend -- entitlements
npm run test -w backend -- webhooks
npm run test -w backend -- payments

# Playwright (frontend upgrade + token-store flow, mocked provider redirect)
npm run dev
npm run test:e2e -- payments-checkout
```
Vitest cases:
- **entitlement reflects active subscription** (`subscription/__tests__/entitlements.test.ts`, `describe.skipIf(!DB_UP)`): a user with an active `daily` pass (status `active`, `currentPeriodEnd` in the future) resolves to `active: true` with chats/images/videos limits from `PLANS.daily`; an expired pass resolves back to free; a free user reflects `10 - freeMessagesUsed`.
- **gate honors entitlement** (`subscription/__tests__/paywall.test.ts`): after activation `assertCanChat` allows up to the plan quota then throws `PaywallError(scope:"plan_quota")`; `assertCanConsumeMedia(user,"image")` allows within quota and throws when exhausted or when free (0 image quota). A downgrade event flips the user back to free-gated on the next check.
- **webhook activation -> entitlement change** (`payments/webhooks/__tests__/`, DB-guarded): feed a signed `subscription.activated` (or plan `transaction.completed`) with `plan:"monthly"`; assert `Subscription.plan === "monthly"`, `status === "active"`, `currentPeriodEnd ~ now + 30d`, and that a subsequent `entitlementsFor` reports `active: true`. A `subscription.canceled` sets `plan:"free"` and `entitlementsFor` resolves free.
- **webhook handler dedup / idempotency** (`payments/webhooks/__tests__/webhooks.test.ts`): process the SAME `(provider, eventId)` twice (via `processSubscriptionEvent` and/or the route). Assert `recordEvent` returns `true` then `false`, the second call returns `{ applied:false, effect:"duplicate" }`, and the side effect (tier flip / token grant) applied exactly once (no double grant on the `TokenLedger`, no double plan flip).
- **signature + shape** (all four providers incl. crypto): a tampered signature -> `verifySignature` false -> route 401; a valid signature but malformed body -> Zod reject -> 400; a valid CCBill/Verotel/SegPay/crypto payload normalizes to the expected `NormalizedEvent`.
- **token pack credits via ledger** (DB-guarded): a `transaction.completed` with a known `tokenPackId` writes one `TokenLedger` `purchase` row and raises `User.tokenBalance` by the pack credits; an unknown pack -> `effect:"unknown_pack"`, no ledger write.
- **mature guard** (`payments/provider.test.ts` extension): the provider order contains only adult processors; `assertMatureCompatibleProvider("stripe")` throws; there is no Stripe adapter reachable.

Playwright (`e2e/payments-checkout.spec.ts`), provider redirect + webhook mocked:
- Upgrade flow: on the billing/upgrade page, plan cards render from a mocked `GET /billing/plans`; click "Continue" on a plan; the app POSTs `/billing/subscribe` and is redirected to the mocked hosted `checkoutUrl` (intercept and assert the URL is a provider host, never a Stripe URL). Return to the app, POST a **simulated signed webhook** to `/webhooks/:provider` (activation), then assert the polled `/billing/entitlements` flips to `active: true` and the current-plan panel shows the plan + expiry.
- Paywall modal: with entitlements mocked to a free user at the limit, sending a chat triggers the `paywall` frame; assert the input is disabled and `PaywallModal` blocks the screen; simulate the activation webhook; assert the poll re-enables input.
- Token store: buy a pack -> redirect to mocked hosted checkout -> simulate the `transaction.completed` webhook -> assert the displayed token balance increases.

MANUAL sandbox steps (local, no live keys):
1. Boot local Postgres (docker-compose) and the backend + frontend dev servers.
2. Set `PAYMENT_PRIMARY_PROVIDER=ccbill` and leave provider keys empty (or point at a sandbox account you own). With keys empty the chain skips to the stub; with sandbox keys the adapter returns a real sandbox hosted URL.
3. Open `/billing` (or `/upgrade`): confirm plan cards render from `/billing/plans` and the current-plan panel from `/billing/entitlements`.
4. Click a plan -> confirm redirect to a provider-hosted (sandbox) URL, never a Stripe URL.
5. Simulate the provider webhook against `POST /webhooks/<provider>` with a correctly-signed sandbox payload (use the provider's sandbox signing secret). Confirm: `WebhookEvent` row created once, `Subscription` updated (plan/status/currentPeriodEnd), and `/billing/entitlements` now reports `active:true`.
6. Re-POST the identical webhook: confirm it is a no-op (`effect:"duplicate"`), no double grant.
7. Buy a token pack in the token store, simulate the `transaction.completed` webhook, confirm the balance rises by the pack credits and exactly one `TokenLedger` `purchase` row exists.

## Sanity checklist
- [ ] Free user: chat is gated at `FREE_MESSAGE_LIMIT` (10); voice/image/premium-model features are blocked; the paywall modal opens on the `paywall` event and disables the input.
- [ ] After a simulated activation webhook, `Subscription` (plan/status/currentPeriodEnd) updates, `entitlementsFor` reports `active:true`, and the previously-gated feature unlocks (chat continues, media allowed within the plan quota).
- [ ] Buying a token pack redirects to a provider-hosted URL; the credit appears only after the webhook writes a `TokenLedger` `purchase` entry; the client never writes the ledger.
- [ ] Token spend debits the balance (existing Phase-07 `debitTokens` path) and the store reflects the new balance after purchase.
- [ ] Webhook idempotency: replaying the same `(provider, eventId)` applies the effect exactly once (`recordEvent` -> false on replay, `effect:"duplicate"`, no double grant / double flip).
- [ ] `GET /billing/status` reports the same entitlement truth the server enforces (no drifted inline `TIER_LIMITS`); the billing page and chat header read that single shape.
- [ ] Mature content never routes to Stripe/PayPal: provider order is adult-processors only, no Stripe adapter exists, `assertMatureCompatibleProvider` throws otherwise, and no raw card fields exist anywhere in the app (hosted checkout only).
- [ ] All webhook bodies are Zod-validated at the boundary (all four providers), bad signature -> 401, bad shape -> 400.
- [ ] No em dashes; TypeScript strict; the UI computes no price/quota/grant locally.

## Done criteria
- Checkout/upgrade UI (`/billing` + `/upgrade` + `PaywallModal`) drives plan cards and the current-plan panel entirely from `GET /billing/plans` and `GET /billing/entitlements`, and "Continue" redirects to a provider-hosted checkout URL (never Stripe).
- Token store lists packs, redirects to hosted checkout, and shows the balance credited through the `TokenLedger` by the webhook.
- Entitlements/limits (daily messages, voice, image, premium model) end to end reflect the active `Subscription` + token balance; `GET /billing/status` is entitlement-truthful with no drifted matrix.
- Webhook activation verified: signed provider webhook -> `WebhookEvent` dedup -> `Subscription` update -> entitlement change; replay is a no-op; the missing crypto (token-pack) webhook is added and Zod-guarded.
- Processor recommendation documented (CCBill primary, SegPay fallback, Verotel third, crypto for one-time token packs only).
- Vitest (entitlement/enforcement + webhook dedup) and Playwright (upgrade + token-store with mocked redirect + simulated webhook) green (or cleanly skipped when no DB); manual sandbox flow walked.

## Guardrail note
STOP before any commit, push, non-local DB migration, ECS/Amplify deploy, Docker push, or secret write. Specifically for this phase: **no live keys** (CCBill/Verotel/SegPay/Coinbase Commerce), **no live-mode webhook endpoint registration** with any processor, and **no secret rotation** into SSM/Secrets Manager or any hosted env, each requires an explicit, fresh, per-action human approval. Sandbox/test-mode keys you own may be used locally, but never commit them; keep them in an un-tracked local `.env`. Local work (edits, local Postgres, local tests with mocked/stubbed providers, local dev server, simulated webhooks against localhost) proceeds without approval. Prior approval never carries to the next action.
