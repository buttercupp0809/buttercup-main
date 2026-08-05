# Phase 21 - Strict, un-bypassable paywall enforcement

## Goal
Make the paywall real. Today `assertCanConsume()` / `checkUsageLimit()` are **defined in `enforce.ts` but never called**, so nothing is gated. This phase wires **server-side** enforcement at EVERY chat entry point (both `ws/gateway.ts` `chat.send` and `http/chat-stream.ts`) and every media enqueue, using the Phase 20 plan + free-trial model. If a user has no active plan and `freeMessagesUsed >= FREE_MESSAGE_LIMIT (10)`, or an active plan's chat quota is exhausted, the server **does not generate**: it emits a `paywall` event (WS) / SSE `paywall` event with the reason + plan options and stops. Counters increment **only after a successful assistant reply**, atomically. Media jobs additionally check plan quota before enqueue, on top of the existing token debit. The frontend blocks the chat input and shows a payment modal on `paywall`, resuming only after the webhook marks an active plan (poll entitlements). No client-trusted counters anywhere.

Reference: PRD §2.6 (strict, un-bypassable enforcement, server-side only), §4 (non-functional / guardrails: no client-trusted counters, no double-charge, both transports enforce identically).

## Prerequisites
- Phase 20 green: `backend/src/subscription/plans.ts` (`FREE_MESSAGE_LIMIT`, `PLANS`, `getPlanConfig`), `entitlements.ts` (`entitlementsFor`), `period.ts` (`planPeriodKey`), `Subscription.plan` + `User.freeMessagesUsed` columns, `GET /billing/entitlements` + `GET /billing/plans`.
- Existing: `backend/src/subscription/enforce.ts` (`PaywallError`, `assertCanConsume`, `checkUsageLimit`, `incrementUsage`), `backend/src/chat/engine.ts` (`runChatTurn`), `backend/src/ws/gateway.ts` (`chat.send`), `backend/src/http/chat-stream.ts` (SSE), `backend/src/http/media.ts` (`handleEnqueue`), `backend/src/queue/media-worker.ts` (token debit).
- `packages/shared` for the WS/SSE event shapes so client + server share one type.

## Context to paste into Cursor
```
You are implementing Phase 21 of Poppy (see prds/experience-monetization-prd.md §2.6, §4).

The paywall is currently DEAD CODE. assertCanConsume()/checkUsageLimit() exist in
backend/src/subscription/enforce.ts but no route calls them. Wire strict server-side
gating using the Phase-20 plan model.

RULES:
- Enforce BEFORE runChatTurn() in BOTH transports: ws/gateway.ts (case "chat.send")
  AND http/chat-stream.ts. Identical logic, no transport can bypass the other.
- Gate: user with no active plan and freeMessagesUsed >= FREE_MESSAGE_LIMIT (10),
  OR active plan chat quota exhausted -> DO NOT generate. Emit a paywall event with
  reason + plan options, then stop the turn.
- Increment the counter ONLY on a successful assistant reply:
    free trial   -> atomic increment of User.freeMessagesUsed
    active plan  -> atomic increment of UsageCounter (counterType "chat", plan period)
  A crisis-intervention turn (no model generation) does NOT consume a chat.
- Media: image/video enqueue calls assertCanConsume(userId, "image"|"video") for the
  PLAN quota, in addition to the existing token balance check and the worker's debit.
- Concurrency: two turns racing must never push the count past the limit. Use atomic
  DB writes (upsert increment / conditional update), never read-modify-write in JS.
- The client is NEVER trusted. No client-side counting gates anything. The paywall
  event only drives UI.

No em dashes. TypeScript strict. Preserve existing WS/SSE event order and the AI
disclosure + SB 243 safety behavior. No double-charge.
```

## Build steps

1. **Refactor `enforce.ts` onto the plan model: `backend/src/subscription/enforce.ts`**
   - Add `export interface PaywallInfo { reason: string; scope: "free_trial" | "plan_quota"; kind: "chat" | "image" | "video"; used: number; limit: number; plans: PlanCatalogEntry[] }` where `plans` is the Phase-20 plan catalog (label/price/duration/quotas) so the client can render options directly from the event.
   - Add `export async function assertCanChat(userId: string): Promise<void>`:
     1. `ent = await entitlementsFor(userId)`.
     2. If `ent.active` (paid plan): if `ent.chats.limit !== -1 && ent.chats.remaining <= 0` -> `throw new PaywallError("plan_chat_quota_exhausted", 402, paywallBody("plan_quota","chat",ent))`.
     3. Else (free): if `ent.chats.remaining <= 0` (i.e. `freeMessagesUsed >= FREE_MESSAGE_LIMIT`) -> `throw new PaywallError("free_trial_exhausted", 402, paywallBody("free_trial","chat",ent))`.
     4. Otherwise return (allowed).
   - Add `export async function assertCanConsumeMedia(userId: string, kind: "image" | "video"): Promise<void>`:
     - `ent = await entitlementsFor(userId)`; if not `ent.active` or the plan's `images`/`videos` quota is exhausted -> throw `PaywallError` with `paywallBody("plan_quota", kind, ent)`. This is the PLAN gate; the token debit stays separate.
   - Add atomic increments used only after success:
     - `export async function consumeFreeMessage(userId: string): Promise<number>` -> `prisma.user.update({ where: { id }, data: { freeMessagesUsed: { increment: 1 } } })` (atomic column increment).
     - `export async function consumePlanQuota(userId, kind, plan, currentPeriodEnd)` -> `usageCounter.upsert` with `counterType = kind` and `period = planPeriodKey(plan, currentPeriodEnd)`, `count: { increment: 1 }` (atomic upsert, the existing pattern in this file).
   - Keep the legacy `assertCanConsume`/`checkUsageLimit`/`incrementUsage` exports for back-compat, but the chat path now uses `assertCanChat` and the media path uses `assertCanConsumeMedia`.
   - Add `paywallBody(scope, kind, ent)` that builds the normalized `{ reason, scope, kind, used, limit, plans, upgradeUrl: "/billing?upgrade=1" }`.

2. **Shared paywall event type: `packages/shared/src/chat-events.ts`** (or wherever chat WS/SSE frames are defined)
   - Add a `paywall` frame the client and both transports share:
     ```ts
     export interface PaywallEvent {
       type: "paywall";
       conversationId: string;
       reason: string;
       scope: "free_trial" | "plan_quota";
       kind: "chat" | "image" | "video";
       used: number;
       limit: number;   // -1 = unlimited (won't fire for chat)
       plans: Array<{ plan: string; label: string; priceUsd: number; durationDays: number; chats: number; images: number; videos: number }>;
     }
     ```
   - Extend the WS outbound union and add the SSE event name `paywall`.

3. **WS gateway enforcement: `backend/src/ws/gateway.ts` (`case "chat.send"`)**
   - AFTER the rate-limit `takeToken` check and BEFORE `runChatTurn(...)`:
     ```ts
     try {
       await assertCanChat(session.userId);
     } catch (err) {
       if (err instanceof PaywallError) {
         send(ws, { type: "paywall", conversationId: parsed.conversationId, ...err.body });
         writeAuditLog({ userId: session.userId, action: "chat.paywall_block", resource: `conversation:${parsed.conversationId}` });
         session.inflight.delete(parsed.conversationId); // if already set
         return; // never generate
       }
       throw err;
     }
     ```
   - Do NOT create the `AbortController` / call `runChatTurn` when blocked. The `paywall` frame replaces `chat.token`/`chat.done` for this turn.

4. **SSE enforcement: `backend/src/http/chat-stream.ts`**
   - AFTER `res.writeHead(200, {text/event-stream ...})` and BEFORE `runChatTurn(...)`:
     ```ts
     try {
       await assertCanChat(userId);
     } catch (err) {
       if (err instanceof PaywallError) {
         sseWrite(res, "paywall", { conversationId: body.conversationId, ...err.body });
         res.end();
         return true;
       }
       throw err;
     }
     ```
   - Identical gate to WS so neither transport is a bypass. (Keep the 200 head so EventSource clients receive the `paywall` event cleanly rather than a raw HTTP error.)

5. **Count only on success + return whether a chat was consumed: `backend/src/chat/engine.ts`**
   - The engine already knows if the turn generated a real reply vs a crisis intervention. Extend `RunChatTurnResult` with `consumedChat: boolean` (`false` for the crisis-intervention early return, `true` after a real assistant message is persisted).
   - The engine itself should NOT increment plan/free counters (keep it transport-agnostic). Instead, the callers (gateway + SSE) increment after `runChatTurn` resolves successfully, based on `result.consumedChat`. Add a tiny helper the callers use:
     ```ts
     export async function recordChatConsumption(userId: string): Promise<void> {
       const ent = await entitlementsFor(userId);
       if (ent.active) await consumePlanQuota(userId, "chat", ent.plan, ent.expiresAt ? new Date(ent.expiresAt) : null);
       else await consumeFreeMessage(userId);
     }
     ```
     Call it in both the WS and SSE success paths, guarded by `if (result.consumedChat)`, AFTER `chat.done` / SSE `done` is emitted (so a failed stream never consumes). A crisis intervention (`safety: true`, `consumedChat: false`) does not consume a chat.
   - Atomic message persistence: wrap the user-message create + assistant-message create + `conversation.update(messageCount += 2)` for a normal turn in a single `prisma.$transaction([...])` so a turn never leaves a half-written pair. (Phase 23 hardens this further; do the minimal atomic wrap here.) Populate `Message.tokenCost` on the assistant message if the provider returns usage; otherwise leave null (Phase 23 fills reliably).

6. **Media plan gate: `backend/src/http/media.ts` (`handleEnqueue`)**
   - For `kind === "image" | "video"`, BEFORE the existing token-balance check, add:
     ```ts
     try {
       await assertCanConsumeMedia(userId, kind);
     } catch (err) {
       if (err instanceof PaywallError) return send(res, 402, err.body);
       throw err;
     }
     ```
   - Keep the existing `tokenBalance < cost` check and the worker's `debitTokens`. On a **successful** media job (worker completion), increment the plan quota once via `consumePlanQuota(userId, kind, plan, periodEnd)`. Do the increment where the job is marked complete (media worker success path) so a failed/refunded job does not consume plan quota. Guard against double-count on BullMQ retries (only increment on terminal success, keyed idempotently).
   - Note: `voice` is not plan-quota-gated in the plan model (plans track chats/images/videos); keep voice on the existing token path only unless you add a `voice` quota to `plans.ts`.

7. **Frontend paywall handling: `frontend/app/(protected)/chat/ChatWindow.tsx`** (and the WS/SSE client hook)
   - Handle the `paywall` frame from both transports: set a `paywalled` state, **disable the chat input** (and the send button), and open a **blocking payment modal**.
   - New `frontend/app/(protected)/chat/PaywallModal.tsx`: renders the 3 plans from the event's `plans` array (or fetches `GET /billing/plans`), each "Continue" -> `POST /billing/subscribe { plan }` -> redirect to `checkoutUrl` (reuse the billing `post()` pattern). Copy reflects the `scope` (free-trial exhausted vs plan quota used up).
   - **Resume flow**: after returning from checkout, poll `GET /billing/entitlements` (e.g. every few seconds, bounded) until `active === true` (webhook has landed), then clear `paywalled` and re-enable input. Never re-enable based on a client counter; only the server entitlement flips it.
   - Do NOT keep a client-side "messages left" counter that gates sending. The client may *display* `entitlements.chats.remaining` for UX, but sending is always attempted and the server decides.

8. **Audit + metrics**
   - `writeAuditLog` on every `chat.paywall_block` and `media.paywall_block`.
   - Counters: `paywall_hit` (by scope + kind), `free_trial_exhausted`, `plan_quota_exhausted` (PRD §4 observability).

## Test instructions
```
# Vitest (backend, DB-guarded)
npm run test -w backend -- enforce
npm run test -w backend -- paywall

# Playwright (frontend, mocked entitlements + webhook)
npm run dev
npm run test:e2e -- paywall
```
Vitest cases (`subscription/__tests__/paywall.test.ts`, `describe.skipIf(!DB_UP)`):
- **10 free replies then paywall**: a free user gets `assertCanChat` OK for 10 consumed replies; the 11th throws `PaywallError` with `scope: "free_trial"`. Each pass calls `recordChatConsumption` to bump `freeMessagesUsed`.
- **active plan up to quota then paywall**: user with an active daily pass (chats = N) is allowed N times, then `assertCanChat` throws `scope: "plan_quota"`; counter is the plan-period `UsageCounter`.
- **media blocked without quota**: `assertCanConsumeMedia(userId, "image")` throws for a free user (0 image quota) and for an active plan whose image quota is exhausted.
- **counter increments only on success**: a turn that ends in a crisis intervention (`consumedChat === false`) does NOT bump `freeMessagesUsed`/`UsageCounter`; a normal turn does.
- **concurrency / atomicity**: fire K concurrent `recordChatConsumption` for a free user near the limit (Promise.all) and assert `freeMessagesUsed` lands exactly at the true count (atomic increment, no lost updates); a parallel batch cannot exceed the plan quota either.
- **transport parity**: unit-test that both the WS handler and the SSE handler call `assertCanChat` and, on `PaywallError`, emit a paywall event and do NOT call `runChatTurn` (mock the engine, assert it was not invoked when blocked).

Playwright (`paywall.spec.ts`): with entitlements mocked to a free user at 9 used, send one message (succeeds), send a 10th, then the next send triggers the `paywall` event; assert the input is disabled and the modal blocks the chat; simulate the webhook flipping `entitlements.active = true`; assert the poll re-enables input and chat continues.

## Sanity checklist
- [ ] `assertCanChat` is called BEFORE `runChatTurn` in BOTH `ws/gateway.ts` and `http/chat-stream.ts`; blocked turns never generate.
- [ ] SSE and WS emit an identical `paywall` payload; neither transport can bypass the other.
- [ ] Free trial hard-blocks at exactly 10 (`FREE_MESSAGE_LIMIT`); active-plan chat blocks at the plan quota.
- [ ] Counters increment ONLY on a successful assistant reply; crisis interventions do not consume a chat; failed/aborted streams do not consume.
- [ ] Increments are atomic (column increment / upsert); concurrent turns cannot exceed the limit.
- [ ] Image/video enqueue is plan-gated via `assertCanConsumeMedia` on top of the token debit; no double-charge and no double-count on BullMQ retries.
- [ ] Frontend disables input + shows a blocking modal on `paywall`; resumes only after `GET /billing/entitlements` reports `active`; no client counter gates sending.
- [ ] Existing streaming/event order, AI-disclosure pill, and SB 243 safety intervention still fire for entitled users (no regression).

## Done criteria
- Both chat transports and the media enqueue enforce the plan/free-trial gate server-side, un-bypassably.
- Counters increment atomically only on success; concurrency-safe; crisis turns free.
- Paywall modal blocks the UI and resumes on entitlement flip via checkout + webhook.
- Full regression: entitled users chat exactly as before; no double-charge; safety + disclosure intact.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret writes, live-mode webhook registration, or ECS/Amplify deploy. This phase reads the Phase-20 columns (`Subscription.plan`, `User.freeMessagesUsed`) and writes `UsageCounter` / `User.freeMessagesUsed`; against any hosted/prod database those writes and any pending migration require explicit, fresh, per-action human approval. Local work (edits, local Postgres, local tests, local dev server) proceeds without it. Prior approval never carries to the next action.
