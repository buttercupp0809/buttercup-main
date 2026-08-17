# Phase 32: Dodo Payments integration + Google sign-in sanity

Two independent features in one prompt. Part A adds Dodo Payments as a new
adult-compatible checkout provider that plugs into the EXISTING ButterCupp
payments architecture (do not rebuild it). Part B audits and finishes Google
sign-in, which is already coded but not configured. Reference for Part A is the
Pellow repo (`../Pellow`), which already ships Dodo as its primary processor.

Read `Plans/cursor-prompt/README.md` (template + ground rules) and
`Plans/cursor-prompt/27-payments-checkout.md` (the existing adult-processor
checkout phase) before starting.

## Goal

- **A. Dodo Payments**: a `dodo` provider that mints hosted checkout links for
  ButterCupp's 3 duration passes (daily/weekly/monthly) and 3 token packs, and a
  signature-verified webhook that activates passes / grants token credits
  through the EXISTING `processSubscriptionEvent` pipeline. Dodo becomes the
  primary processor; ccbill/verotel/segpay/crypto stay as configured fallbacks.
- **B. Google sign-in**: verify the existing end-to-end flow works, fix any gap,
  and produce the exact Google Cloud Console + env config steps.

## Prerequisites

- Phase 20 (plans) and Phase 27 (payments checkout) are in place. The single
  sources of truth already exist and MUST be reused, not duplicated:
  - Duration passes: `backend/src/subscription/plans.ts` (`PLANS`: daily $1/1d,
    weekly $6/7d, monthly $25/30d; `free` is not purchasable).
  - Token packs: `backend/src/payments/webhooks/shared.ts` (`TOKEN_PACKS`:
    `pack_100` $2, `pack_500` $8, `pack_2000` $25).
  - Adapter contract + provider chain: `backend/src/payments/provider.ts`
    (`isConfigured()` + `createCheckout()`; primary = `PAYMENT_PRIMARY_PROVIDER`).
  - Webhook pipeline: `backend/src/payments/webhooks/shared.ts`
    (`processSubscriptionEvent` -> `activatePlan` / `grantMonthlyTokens` /
    `refundTokens` / downgrade; idempotent via the `WebhookEvent` unique index).
  - Normalized event contract: `backend/src/payments/types.ts` (`NormalizedEvent`).
- The adult-processor lock is a COMPILE-TIME type guard in
  `backend/src/payments/types.ts` (`ForbiddenProviders = "stripe" | "paypal"`).
  Adding `"dodo"` to `PaymentProvider` is allowed; adding stripe/paypal is a
  type error. Do NOT weaken that guard.
- Install the SDK in the BACKEND workspace: `npm i dodopayments -w backend`
  (Pellow pins `dodopayments@^2.34.0`; match or newer).

## Context to paste into Cursor

ButterCupp's payments live in the BACKEND (`backend/src/payments/`), unlike
Pellow's (frontend). The provider is a duration-pass model (one-time grants that
expire after `durationDays`), NOT recurring subscriptions and NOT PPP-tiered.
Mirror Pellow's Dodo MECHANICS (SDK client, `checkoutSessions.create`,
Standard-Webhooks verification via `client.webhooks.unwrap`, the
metadata-carries-intent contract) but map them onto ButterCupp's adapter
interface and `NormalizedEvent` pipeline.

Pellow reference files (read, do not copy verbatim):
- `../Pellow/frontend/lib/payments/dodo.ts` (client + `checkoutSessions.create`)
- `../Pellow/frontend/lib/payments/webhooks/dodo.ts` (`client.webhooks.unwrap`,
  the `SUBSCRIPTION_EVENT_MAP` / `PAYMENT_EVENT_MAP`)
- `../Pellow/frontend/app/api/webhooks/dodo/route.ts` (raw body + `webhook-id` /
  `webhook-signature` / `webhook-timestamp` headers)

ButterCupp reference files to mirror the shape:
- `backend/src/payments/ccbill.ts` (adapter: `isConfigured` + `createCheckout`)
- `backend/src/payments/webhooks/ccbill.ts` (schema + `verifySignature` +
  `TYPE_MAP` + `normalize` -> `NormalizedEvent`)
- `backend/src/http/billing.ts` (`/billing/subscribe`, `/billing/tokens`,
  `/webhooks/<provider>` routing)

## Concrete paths

Create:
- `backend/src/payments/dodo.ts` — the checkout adapter.
- `backend/src/payments/webhooks/dodo.ts` — verify + normalize.

Edit:
- `backend/src/payments/types.ts` — add `"dodo"` to `PaymentProvider` and
  `ADULT_PROVIDERS`. Leave `ForbiddenProviders` untouched.
- `backend/src/payments/provider.ts` — register `dodo` in `ADAPTERS`.
- `backend/src/http/billing.ts` — extend the `/webhooks/(...)` route regex to
  include `dodo`, and give Dodo a RAW-body path (see build step A5).
- `backend/.env.example` and `Plans/aws-automation/secrets.env` (git-ignored) —
  add the `DODO_*` vars.
- Google (Part B): only if the sanity audit finds a gap.

## Build steps

### Part A: Dodo Payments

**A1. Types.** In `types.ts`: `PaymentProvider = "ccbill" | "verotel" | "segpay"
| "crypto" | "dodo"` and add `"dodo"` to `ADULT_PROVIDERS`. Run `npm run
typecheck -w backend` and confirm the `AssertDisjoint` guard still compiles
(proves stripe/paypal are still impossible).

**A2. Product mapping via env (6 products, no PPP tiers).** Dodo product IDs
come from env, resolved by plan or token-pack id:
```
DODO_PRODUCT_DAILY, DODO_PRODUCT_WEEKLY, DODO_PRODUCT_MONTHLY
DODO_PRODUCT_PACK_100, DODO_PRODUCT_PACK_500, DODO_PRODUCT_PACK_2000
```
Add a small resolver in `dodo.ts`: `plan -> DODO_PRODUCT_<PLAN.toUpperCase()>`,
`tokenPackId -> DODO_PRODUCT_<PACKID.toUpperCase()>`. Throw a clear error if the
matching env var is unset (so a misconfig fails loud at checkout, not silently).

**A3. Client + adapter (`dodo.ts`).** Mirror Pellow's client:
```ts
import DodoPayments from "dodopayments";
let _client: DodoPayments | null = null;
function client(): DodoPayments | null {
  if (_client) return _client;
  const bearerToken = process.env.DODO_API_KEY;
  if (!bearerToken) return null;
  _client = new DodoPayments({
    bearerToken,
    environment: process.env.DODO_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode",
  });
  return _client;
}
export function isConfigured(): boolean {
  return Boolean(process.env.DODO_API_KEY);
}
export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
  const c = client();
  if (!c) throw new Error("dodo_not_configured");
  const productId = resolveProductId(req); // A2
  const session = await c.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    return_url: req.successUrl,
    cancel_url: req.cancelUrl,
    // METADATA IS THE CONTRACT between checkout and webhook (mirror Pellow):
    // the webhook trusts these, not a product-id reverse lookup.
    metadata: {
      userId: req.userId,
      intent: req.intent,                 // "subscription" | "tokens"
      plan: req.plan ?? "",               // daily | weekly | monthly
      tokenPackId: req.tokenPackId ?? "",
    },
  });
  const url = session.checkout_url;
  if (!url) throw new Error("dodo_no_checkout_url");
  return { provider: "dodo", checkoutUrl: url, externalId: session.session_id };
}
```
DECISION (one-time vs recurring): ButterCupp passes are one-time grants that
expire, so create the 3 passes as Dodo ONE-TIME products (least change; the
existing `activatePlan` sets `currentPeriodEnd = now + durationDays`). If you
later want auto-renewing monthly, make ONLY the monthly a Dodo subscription
product; the webhook map below already treats `subscription.renewed` as a
re-activation, so renewals re-extend the pass with no extra code.

**A4. Webhook (`webhooks/dodo.ts`).** Verify with the SDK (Standard Webhooks;
do NOT hand-roll HMAC) then normalize using METADATA:
```ts
export function verifyAndParse(rawBody: string, headers: Record<string,string>) {
  const c = client(); // same lazy client, needs DODO_WEBHOOK_KEY set on it
  if (!c) throw new Error("dodo_not_configured");
  return c.webhooks.unwrap(rawBody, { headers }); // throws on bad signature
}
const EVENT_MAP: Record<string, NormalizedEvent["eventType"]> = {
  "subscription.active": "subscription.activated",
  "subscription.renewed": "subscription.activated",
  "subscription.cancelled": "subscription.canceled",
  "subscription.expired": "subscription.canceled",
  "subscription.on_hold": "subscription.past_due",
  "payment.succeeded": "transaction.completed",
  "payment.failed": "payment_failed",
};
export function normalize(evt: UnwrappedDodoEvent): NormalizedEvent | null {
  const eventType = EVENT_MAP[evt.type];
  const md = evt.data?.metadata ?? {};
  if (!eventType || !md.userId) return null;
  // A one-time PASS purchase arrives as payment.succeeded with intent!=tokens.
  // A TOKEN pack arrives as payment.succeeded with intent==tokens.
  const isTokens = md.intent === "tokens" && md.tokenPackId;
  return {
    provider: "dodo",
    eventId: evt.data?.payment_id ?? evt.data?.subscription_id ?? `${evt.type}:${evt.business_id}:${evt.timestamp}`,
    eventType: isTokens && eventType === "transaction.completed" ? "transaction.completed"
             : eventType === "transaction.completed" ? "subscription.activated" // one-time pass
             : eventType,
    userId: md.userId,
    plan: md.plan && md.plan !== "" ? md.plan as Plan : undefined,
    tokenPackId: isTokens ? md.tokenPackId : undefined,
    externalSubscriptionId: evt.data?.subscription_id,
    currency: evt.data?.currency, amount: evt.data?.total_amount,
    raw: evt as unknown as Record<string, unknown>,
  };
}
```
Key point: the existing `processSubscriptionEvent` already does the right thing
with this `NormalizedEvent` (subscription.activated+plan -> `activatePlan`;
transaction.completed+tokenPackId -> grant `TOKEN_PACKS[id].credits`;
canceled/past_due -> downgrade). You are NOT rewriting activation logic.

**A5. Route with RAW body (`billing.ts`).** Standard-Webhooks verification needs
the exact raw bytes and the `webhook-id/webhook-signature/webhook-timestamp`
headers. The existing form-encoded providers pre-parse the body; Dodo must NOT.
Add a dodo branch that reads the raw request body string and the three headers,
calls `verifyAndParse`, then `normalize`, then `processSubscriptionEvent`.
Extend the route matcher: `/^\/webhooks\/(ccbill|verotel|segpay|crypto|dodo)\/?$/`.
On signature failure return 400 and `writeAuditLog({action:"webhook.signature_failed",resource:"dodo"})`. Always return 200 for a
verified-but-unhandled event (so Dodo does not retry forever).

**A6. Provider registration + primary.** Add `dodo` to `ADAPTERS` in
`provider.ts`. Set `PAYMENT_PRIMARY_PROVIDER=dodo` in env so
`getProviderOrder()` puts Dodo first; the others remain as fallbacks when their
keys are set.

**A7. Env.** Add to `backend/.env.example` (documented, empty) and to the
git-ignored `Plans/aws-automation/secrets.env` (real values):
```
PAYMENT_PRIMARY_PROVIDER=dodo
DODO_API_KEY=            # secret (bearer token)
DODO_WEBHOOK_KEY=        # secret (Standard-Webhooks signing key)
DODO_ENVIRONMENT=test_mode   # test_mode | live_mode
DODO_PRODUCT_DAILY=      DODO_PRODUCT_WEEKLY=      DODO_PRODUCT_MONTHLY=
DODO_PRODUCT_PACK_100=   DODO_PRODUCT_PACK_500=    DODO_PRODUCT_PACK_2000=
```
For prod these ship as ECS task secrets (mirror how POPPY_*/OPENROUTER live in
`Plans/aws-automation/secrets.env` -> Secrets Manager -> task def). The
frontend does NOT need any DODO_* var; checkout is minted by the backend.

**A8. Frontend wiring (already present).** The billing UI already calls
`POST /billing/subscribe` and `/billing/tokens` and redirects to the returned
`checkoutUrl` (Phase 27). Confirm it redirects to `checkoutUrl` for provider
`dodo` unchanged. No new frontend code should be required; if the current UI
hardcodes a provider, generalize it to use the returned URL.

**A9. (Optional) cancel + portal.** Add `cancelAtPeriodEnd(subId)` via
`client.subscriptions.update()` and a `getPortalUrl(customerId)` via
`client.customers.customerPortal.create()` for the settings page, mirroring
Pellow. Only needed if you use Dodo subscription (recurring) products.

### Part B: Google sign-in sanity

The flow is already implemented; audit and fix, do not rebuild:
- Frontend button: `frontend/components/auth/GoogleButton.tsx` (GIS script,
  reads `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; hides itself when unset).
- Server verify: `frontend/app/api/auth/oauth/google/route.ts` (verifies the
  Google ID token against JWKS with `audience = GOOGLE_CLIENT_ID`, links on
  `googleId`/email, sets the auth cookie, returns `needsAgeGate`). Returns 501
  when `GOOGLE_CLIENT_ID` is unset.
- DTO: `GoogleOAuthDto` in `packages/shared/src/dto/auth.ts`.
- Schema: `User.googleId @unique`, `User.oauthProvider` exist.

**B1.** Confirm the three env vars are wired the SAME way the cookie fix is:
`GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` are already in the
`amplify.yml` server-env allow-list; confirm they are also present (even if
empty) in `Plans/aws-automation/amplify-env.env`. `GOOGLE_CLIENT_SECRET` is only
needed if you add a server-side auth-code exchange (the current GIS ID-token
flow does not need it).
**B2.** Confirm the linking logic handles all three cases: brand-new Google
user, existing email that signed up with password (links `googleId`), and
returning Google user. Add a test if missing.
**B3.** Confirm `needsAgeGate` routes a fresh Google user through the age gate
before any mature content (Google users have no `dob`/`jurisdiction` yet).
**B4.** No code fix is expected beyond wiring; the real blocker is
configuration (see Manual steps). If the audit finds the button not rendering
or the 501 in prod, it is because `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` are empty in the Amplify env, not a code bug.

## Test instructions

Automated (Vitest, backend):
- `dodo.test.ts`: `isConfigured()` false with no key; `createCheckout` for each
  plan and each token pack resolves the right `DODO_PRODUCT_*` and throws on a
  missing product env; metadata carries `userId/intent/plan/tokenPackId`.
- `webhooks/dodo.test.ts`: a tampered body/bad signature is rejected (unwrap
  throws -> 400); a valid `payment.succeeded` with `intent!=tokens` normalizes
  to `subscription.activated` + `plan`; with `intent=tokens` to
  `transaction.completed` + `tokenPackId`; `subscription.cancelled` ->
  `subscription.canceled`; duplicate `eventId` is a no-op (idempotency).
- Provider chain: with `PAYMENT_PRIMARY_PROVIDER=dodo`, `getProviderOrder()[0] === "dodo"`; `assertMatureCompatibleProvider("dodo")` does NOT throw;
  `("stripe")` still throws.
- Run: `npx vitest run backend/src/payments`, `npm run typecheck`,
  `npm run check:no-em-dash`, `npm run lint`.

Manual E2E (Dodo test_mode):
1. Create the 6 products in the Dodo dashboard (test mode), paste their ids into
   `secrets.env`, restart the backend.
2. From the billing page buy the Daily pass -> land on Dodo hosted checkout ->
   pay with a Dodo test card -> redirect back -> confirm `Subscription.plan=daily`,
   `status=active`, `currentPeriodEnd ~ now+1d`, and chat quota reflects the pass.
3. Buy `pack_500` -> confirm `tokenBalance += 500` and a `WebhookEvent` row.
4. Replay the same webhook delivery -> confirm no double-grant (idempotent).
5. Point the Dodo dashboard webhook at `https://api.buttercupp.fun/webhooks/dodo`
   for prod (test_mode first).

Manual E2E (Google): set the client id locally, load `/signup`, confirm the
Google button renders, complete Google sign-in, confirm a `User` row with
`googleId`, and that a fresh user is sent to the age gate.

## Sanity checklist

- [ ] `npm run typecheck` passes; the `AssertDisjoint` guard still compiles (no stripe/paypal).
- [ ] `getProviderOrder()` returns dodo first when `PAYMENT_PRIMARY_PROVIDER=dodo`; ccbill/verotel/segpay/crypto still work as fallbacks.
- [ ] Each of the 3 passes and 3 token packs resolves to a distinct `DODO_PRODUCT_*`; a missing id throws at checkout (loud, not silent).
- [ ] Webhook: bad signature -> 400 + audit log; good event -> 200; duplicate -> no-op; unhandled -> 200 (no infinite Dodo retries).
- [ ] Buying a pass sets `Subscription.plan/status/currentPeriodEnd` via the EXISTING `activatePlan`; buying a pack credits `tokenBalance` via the EXISTING `TOKEN_PACKS` map. No plan/price numbers are duplicated anywhere.
- [ ] Google button renders only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set; server returns 501 (not 500) when unset; a fresh Google user hits the age gate.

## Security checklist

- [ ] Webhook signature verified on the RAW body via `client.webhooks.unwrap` BEFORE any DB write; never trust an unverified body. Timing-safe (SDK-provided).
- [ ] `userId`/`plan`/`tokenPackId` are read from Dodo `metadata` we set at checkout, and `metadata.userId` is re-checked; a webhook can only ever affect the user encoded in the verified payload. The Zod/`NormalizedEvent` boundary rejects malformed events.
- [ ] Idempotency: `WebhookEvent (provider,eventId)` unique index prevents double-grant on Dodo retries/replays.
- [ ] `DODO_API_KEY` and `DODO_WEBHOOK_KEY` are SECRETS: never logged, never sent to the frontend, stored in Secrets Manager for prod (not in `amplify-env.env`, which is frontend-only).
- [ ] Adult-processor lock intact: `stripe`/`paypal` remain compile-time impossible; Dodo is added, not a bypass. Confirm Dodo's Merchant-of-Record terms permit ButterCupp's content class BEFORE going live (business gate, see Manual steps).
- [ ] Google: ID token verified against Google JWKS with `audience = GOOGLE_CLIENT_ID` and issuer allow-list; `email_verified` required; no client-trusted identity. `GOOGLE_CLIENT_SECRET` (if ever added) is a secret.
- [ ] No secret values pasted into any committed file; `secrets.env` and `amplify-env.env` stay git-ignored.

## Done criteria

- Dodo is the primary processor: a real test-mode purchase of each of the 6
  products activates the right pass / credits the right tokens through the
  unchanged webhook pipeline, idempotently, signature-verified.
- The other four adult processors still pass their tests and remain selectable
  as fallbacks; the compile-time stripe/paypal lock is intact.
- Google sign-in works end to end once the client id is configured, and the
  exact config steps are documented (below).
- `typecheck`, `lint`, `check:no-em-dash`, and `vitest run backend/src/payments`
  are green.

## Guardrail note

Creating Dodo products, setting the live webhook endpoint, rotating/adding the
`DODO_*` secrets, editing ECS task secrets or Amplify env, committing, and
deploying each require an explicit, fresh, per-action human approval. Do the
code + tests locally in `test_mode` first. Never commit a real key.

---

## Answers to your two questions

### How many products to create in Dodo (for ButterCupp): 6

ButterCupp has no PPP tiers (Pellow has 10 because of its T0-T4 pricing). Create:

| # | Dodo product | Type | Price (from `PLANS`/`TOKEN_PACKS`) | Env var | Grants |
|---|---|---|---|---|---|
| 1 | Daily Pass | one-time | $1 | `DODO_PRODUCT_DAILY` | 1-day pass: 150 chats / 10 img / 2 vid |
| 2 | Weekly Pass | one-time | $6 | `DODO_PRODUCT_WEEKLY` | 7-day pass |
| 3 | Monthly Pass | one-time (or subscription for auto-renew) | $25 | `DODO_PRODUCT_MONTHLY` | 30-day pass |
| 4 | 100 tokens | one-time | $2 | `DODO_PRODUCT_PACK_100` | +100 token credits |
| 5 | 500 tokens | one-time | $8 | `DODO_PRODUCT_PACK_500` | +500 token credits |
| 6 | 2000 tokens | one-time | $25 | `DODO_PRODUCT_PACK_2000` | +2000 token credits |

Make all 6 ONE-TIME products to match ButterCupp's expiring-pass model exactly.
Only if you want the monthly to auto-renew, create product 3 as a Dodo
subscription (monthly interval) instead; the webhook already re-extends on
renewal. Prices are TUNE placeholders in `plans.ts`/`shared.ts` — set the final
numbers there (single source of truth), and make each Dodo product's price
match.

### Google sign-in manual step (config, no code)

1. Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client
   ID -> Application type **Web application**.
2. Authorized JavaScript origins: `https://www.buttercupp.fun` and
   `http://localhost:3000` (for local). (GIS ID-token flow needs origins, not a
   redirect URI.)
3. Configure the OAuth consent screen: app name, support email, scopes
   `openid email profile`, publish it (out of "testing" so any Google user can
   sign in).
4. Copy the Client ID. Set it as BOTH `GOOGLE_CLIENT_ID` and
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value) in `frontend/.env.local` (local)
   and in the Amplify env for prod (both keys are already in the `amplify.yml`
   allow-list). `GOOGLE_CLIENT_SECRET` is not required for the current flow.
5. Redeploy the frontend (Amplify build) so the button renders and the server
   stops returning 501.
