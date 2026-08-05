# Phase 11: Safety & compliance hardening

## Goal
Make ButterCupp compliant with California SB 243 and safe by construction. This phase delivers:
- **Crisis detection** (fast keyword/flag pass + LLM confirmation) mirroring Pellow `crisis-detector.ts`, wired to run **BEFORE generation** in the chat pipeline from phase 04, so urgent cases divert to the **SB 243 self-harm/suicide protocol** (supportive intervention message + crisis resources + suppress harmful generation + log `CrisisEvent`).
- **SB 243 obligations**: persistent AI-disclosure (finalize the phase-01 scaffold), **break reminders** on continuous-use thresholds, accountability/audit logging (audit.ts fire-and-forget pattern), and rigorous logging discipline driven by the **private right of action** ($1,000/violation).
- **Jurisdiction gating** for mature-content availability by region.
- **Content moderation** of user-created **public** characters before publish (integrates with phase 06).
- **Ethical guardrails** (manipulation-risk checks, periodic AI reminders) mirroring Pellow `ethical-guardrails.ts`.

Reference: PRD §5.9, §12 (SB 243 checklist), §10 (safety interception order).

## Prerequisites
- Phases 00 through 10 green: monorepo, Prisma schema (incl. `CrisisEvent`, `AuditLog`, `AnalyticsEvent`, `Character.moderationStatus`, `User.jurisdiction`), auth + age gate (phase 01, has the AI-disclosure scaffold), chat streaming pipeline (phase 04), memory (phase 05), creation wizard + publish (phase 06), billing (phase 10).
- `packages/database` Prisma singleton exported as `@buttercupp/database`. Never `new PrismaClient()`.
- Utilities present from phase 00: `backend/src/utils/audit.ts`, `backend/src/utils/safe-types.ts` (`assertSafeId`, `assertSafeString`), `backend/src/analytics/tracker.ts` (`track`), `backend/src/utils/retry.ts`.
- LLM provider chain from phase 04 (`backend/src/llm/provider.ts`) callable for the confirmation pass.

## Context to paste into Cursor
> Build Phase 11 (Safety & compliance) for ButterCupp per Master PRD §5.9 and §12. Mirror the Pellow safety module verbatim in structure, then extend for SB 243 and mature-content gating.
>
> Pellow reference files to read and mirror (in `../Pellow`):
> - `backend/src/safety/crisis-detector.ts`: tiered keyword phrase lists (LEVEL_1/2/3), `detectCrisisLevel`, `getCrisisResult`, `logCrisisEvent`, `checkCrisis`. Copy the tiering model and the `CrisisResult` shape (`level`, `promptOverride`, `responseAppend`, `immediateResponse`, `flagMessage`).
> - `backend/src/safety/ethical-guardrails.ts`: `shouldSendAIReminder` (72h + 10-message interval, rotating reminder text), `checkManipulationRisk` (loneliness exploitation, social-graph decline, dependency formation, distress-upselling block), `checkDependencySignals`, `getHonestyPromptRules`, `getComplianceStatus`.
> - `backend/src/utils/audit.ts`: `writeAuditLog` fire-and-forget pattern (never throws, never blocks; no PII beyond userId in metadata) and `auditContext(req)`.
> - `backend/src/analytics/tracker.ts`: `track()` fire-and-forget event writer.
>
> Locked decisions (PRD §0): mature/uncensored from day 1, so the SB 243 self-harm protocol is mandatory and jurisdiction gating for mature content is required. No em dashes anywhere. TypeScript strict. Zod on every mutation. Server-centric Next.js 16.
>
> Safety interception order is load-bearing (PRD §10): crisis-detect BEFORE generation. If the fast pass or LLM confirmation returns an urgent level, the protocol path runs and normal LLM generation is skipped entirely.

## Build steps

### 1. Crisis detector (fast pass): `backend/src/safety/crisis-detector.ts`
Mirror Pellow's file. Keep the three tiers and the `CrisisResult` interface. Adapt to ButterCupp's schema:
- Export `type CrisisLevel = 0 | 1 | 2 | 3` and `interface CrisisResult { level; promptOverride; responseAppend; immediateResponse; flagMessage }`.
- Keep `LEVEL_3_PHRASES`, `LEVEL_2_PHRASES`, `LEVEL_1_PHRASES` (self-harm/suicide ideation) and the `RESOURCES` constant (988 Suicide & Crisis Lifeline, Crisis Text Line 741741).
- `detectCrisisLevel(text)`: normalize then phrase-match, return highest matched tier.
- `getCrisisResult(level)`: level 3 returns a pre-written `immediateResponse` (pipeline skipped); level 2 returns `promptOverride` + `responseAppend` resources; level 1 returns a warmth `promptOverride`.
- `checkCrisis(text)`: the fast synchronous entry point.
- `logCrisisEvent(userId, level, trigger, action)`: writes a `CrisisEvent` row (`userId`, `level`, `trigger`, `action`, `createdAt`), truncating content to 2000 chars, wrapped in try/catch (never throws).

### 2. Crisis confirmation (LLM pass): `backend/src/safety/crisis-confirm.ts`
- `confirmCrisisWithLLM(text, fastLevel): Promise<CrisisLevel>`: only invoked when the fast pass returns level >= 1. Sends a tight classification prompt to the phase-04 provider chain ("Classify self-harm/suicide risk: none/low/serious/imminent"), parses to a `CrisisLevel`, and returns `max(fastLevel, llmLevel)` so the fast pass can never be downgraded below its own signal. Wrap in `retry.ts` `RETRY_PRESETS`; on total LLM failure, fall back to the fast-pass level (fail safe, never fail open). Strip any reasoning/thinking blocks from the LLM output before parsing.

### 3. SB 243 protocol orchestrator: `backend/src/safety/sb243-protocol.ts`
- `runCrisisGate({ userId, conversationId, text, req }): Promise<{ intervene: boolean; interventionMessage: string | null; promptOverride: string | null; responseAppend: string | null }>`:
  1. `checkCrisis(text)` fast pass.
  2. If fast level >= 1, `confirmCrisisWithLLM`.
  3. If final level >= 2, this is an intervention: build the supportive intervention message + crisis resources, set `intervene: true` for level 3 (suppress generation entirely and send `immediateResponse`); for level 2 return `promptOverride` + `responseAppend` so generation continues but is steered and resources appended.
  4. Always `logCrisisEvent(...)` for level >= 1 and `writeAuditLog({ action: "crisis.detected", userId, metadata: { level, action } }, ...)` with `auditContext(req)`.
  5. `track("crisis_event", { level }, userId)`.
- This function is the single choke point the chat pipeline calls.

### 4. Wire into the chat pipeline (phase 04): `backend/src/chat/pipeline.ts`
- In the message-handling path, **before** the LLM generation call, invoke `runCrisisGate(...)`.
- If `intervene` is true (level 3): emit `safety.intervention` over the WebSocket with the intervention message, persist an assistant `Message` containing the resources, **do not call the LLM**, return early.
- If level 2: inject `promptOverride` into the system-prompt layers and append `responseAppend` (resources) to the streamed reply.
- Order matters: the crisis gate must sit above memory retrieval and generation. Add an inline comment marking the ordering invariant so later edits do not reorder it.

### 5. Ethical guardrails: `backend/src/safety/ethical-guardrails.ts`
Mirror Pellow. Adapt person/memory queries to ButterCupp's `Message`, `Memory`, `RelationshipState` schema:
- `shouldSendAIReminder(userId)`: 72h + 10-message threshold, rotating reminder text, records `analyticsEvent` "ethical_ai_reminder_sent".
- `checkManipulationRisk(...)`: loneliness exploitation (do not increase frequency), social-graph decline redirect, dependency-formation redirect, distress-based upselling **block** (never surface a subscription/token prompt while the user is in a distress state).
- `checkDependencySignals(userId)`: returns dependency level + optional `redirectContext` string for the prompt layer.
- `getHonestyPromptRules()`: honesty rules injected into the persona prompt layer (includes the no-em-dash rule).
- `getComplianceStatus()`: informational SB 243 / EU AI Act / GDPR readiness report for audit/internal review.

### 6. Persistent AI-disclosure (finalize phase-01 scaffold)
- Backend: `getHonestyPromptRules()` + an AI-disclosure constraint are always included in the system-prompt layers (never optional).
- Frontend: `frontend/components/chat/AiDisclosureBadge.tsx`: a persistent, always-visible "AI companion" indicator in the chat header (from phase 01 scaffold, now made non-dismissible). Add it to first-interaction onboarding copy too.

### 7. Break reminders: `backend/src/safety/break-reminder.ts`
- `checkBreakReminder({ conversationId, sessionStartedAt, lastReminderAt }): { due: boolean; message: string | null }`: fires at continuous-use thresholds (e.g. 60 min of continuous session, then hourly). Track session start in Redis (presence key from phase 07) or on `Conversation`.
- On `due`, emit a `safety.breakReminder` WS event and `track("break_reminder_sent", { conversationId }, userId)`. SB 243 requires break reminders on continuous use; keep the threshold in `config/flags.ts` so it is tunable.

### 8. Jurisdiction gating: `backend/src/safety/jurisdiction.ts`
- `RESTRICTED_MATURE_REGIONS` list + `isMatureAllowed(jurisdiction): boolean`.
- `assertMatureAccess({ user, contentRating })`: throws a typed `MatureContentBlockedError` when `contentRating === "mature"` and the user's `jurisdiction` is restricted or `ageVerificationLevel` is insufficient.
- Call it: in the chat pipeline before serving a mature character, in the gallery filter (phase 03) to hide mature characters for restricted regions, and in `POST /api/media/image|voice`. `writeAuditLog({ action: "jurisdiction.blocked", ... })` on block.

### 9. Public-character moderation: `backend/src/safety/character-moderation.ts` + `POST /api/characters/:id/publish`
- `moderateCharacter(characterVersion): Promise<{ approved: boolean; reasons: string[] }>`: runs the character's name, bio, appearance sheet, and behavioral instructions through the keyword/regex checks plus an LLM policy classifier (illegal content, minors, non-consent). 
- Integrate with phase 06 publish: `POST /api/characters/:id/publish` sets `moderationStatus = "pending"`, enqueues moderation, and **does not flip `visibility` to public** until moderation returns approved (`moderationStatus = "approved"`). On reject, `moderationStatus = "rejected"` with reasons; owner keeps it private. `writeAuditLog({ action: "character.moderation", metadata: { status, reasons } })`.
- Gallery queries (phase 03) must filter `visibility = "public" AND moderationStatus = "approved"`.

### 10. Audit + private-right-of-action note
- Every safety event writes an `AuditLog` row via `writeAuditLog` (fire-and-forget, never blocks the request path): crisis detection, break reminder, jurisdiction block, moderation decision, AI-reminder sent.
- Add a top-of-file comment in `sb243-protocol.ts` documenting that SB 243 creates a **private right of action of $1,000 per violation**, which is why logging here is exhaustive and must never be silently dropped.

### 11. Zod DTOs: `packages/shared/src/safety.ts`
- Schemas for the crisis-confirm request, moderation result, and the `safety.intervention` / `safety.breakReminder` WS payloads. Validate on every boundary.

## Test instructions
Vitest (`backend/src/safety/__tests__/`):
- `npm run test -w backend -- crisis-detector`: sample self-harm inputs across tiers flag the correct `CrisisLevel`; benign inputs return 0.
- `npm run test -w backend -- sb243-protocol`: a level-3 input yields `intervene: true`, the mocked LLM generation is **not called**, and a `CrisisEvent` row + `AuditLog` row are written.
- `npm run test -w backend -- break-reminder`: timer fires exactly at the continuous-use threshold, not before.
- `npm run test -w backend -- jurisdiction`: a restricted-region user requesting a mature character throws `MatureContentBlockedError`; an allowed-region verified user passes.
- `npm run test -w backend -- character-moderation`: a policy-violating character stays `pending`/`rejected` and never becomes public.

Playwright (`frontend/e2e/`):
- `npx playwright test safety-intervention`: sending a self-harm message renders the intervention UI (supportive message + crisis resources), **not** a normal character reply; the AI-disclosure badge is visible throughout.

## Sanity checklist
- [ ] Crisis check runs **before** generation in `chat/pipeline.ts` (verify call order; inline invariant comment present).
- [ ] Level-3 path suppresses normal generation and sends the pre-written crisis message.
- [ ] AI-disclosure badge is always visible in chat and non-dismissible.
- [ ] An `AuditLog` row is written for every safety event (crisis, break reminder, jurisdiction block, moderation).
- [ ] A public character cannot publish while `moderationStatus` is `pending`; gallery only shows `approved` public characters.
- [ ] Restricted-jurisdiction users cannot access mature characters or mature media generation.
- [ ] Break reminder fires at the configured continuous-use threshold.
- [ ] `track("crisis_event", ...)` fires on every intervention.

## Done criteria
All Vitest safety suites and the Playwright intervention test pass. Crisis gate provably precedes generation. SB 243 checklist items (a) AI-disclosure, (b) self-harm protocol, (c) break reminders, (d) audit/accountability are each demonstrably wired and logged. Jurisdiction gating and public-character moderation block the restricted paths. No em dashes in any added file.

## Guardrail note
This phase is code + local tests only. Do **not** commit, push, run any migration against a non-local database, or deploy. Any such action requires a fresh, explicit, per-action human approval. If a schema change is needed (e.g. new `CrisisEvent` columns), generate the migration locally and STOP for approval before applying it anywhere non-local.
