# Phase 12: Settings, account, observability

## Goal
Ship the user-facing settings/account surface and the platform observability layer. This phase delivers:
- **Settings/account UI**: profile edit, password change, content-safety preferences, theme toggle.
- **Chat/memory management**: view/clear/export memory, delete conversations, using the phase-05 memory endpoints.
- **GDPR/CCPA data export + account deletion**: `POST /api/me/export` (full user bundle) and `DELETE /api/me` (irreversible cascade).
- **Sentry** error tracking (frontend + backend), mirroring Pellow.
- **Analytics event taxonomy** via a `track()` mirror of Pellow `analytics/tracker.ts`.
- **Metric counters** (LLM provider outcomes, media job outcomes, latency) mirroring Pellow `metrics.ts`.
- **Security headers** (CSP/HSTS/X-Frame-Options) in `next.config` mirroring Pellow `next.config.ts`.

Reference: PRD §5.10 (settings), §16 (analytics/observability), §15 (security headers).

## Prerequisites
- Phases 00 through 11 green. In particular: auth (phase 01), memory endpoints `GET /api/memory` and `DELETE /api/memory/:id` (phase 05), conversations (phase 04), Prisma schema with `User`, `Conversation`, `Message`, `Memory`, `MemorySummary`, `Character`, `RelationshipState`, `TokenLedger`, `Subscription`, `MediaAsset`, `AnalyticsEvent`, `AuditLog` (phase 02).
- `packages/database` Prisma singleton `@poppy/database`.
- `backend/src/analytics/tracker.ts` and `backend/src/utils/audit.ts` present.

## Context to paste into Cursor
> Build Phase 12 (Settings, account, observability) for Poppy per Master PRD §5.10, §16, §15. Mirror Pellow for the tracker, metrics, and security headers.
>
> Pellow reference files to read and mirror (in `../Pellow`):
> - `backend/src/analytics/tracker.ts`: the fire-and-forget `track(eventName, properties?, userId?)` writer to `AnalyticsEvent`. Copy verbatim, rename import to `@poppy/database`.
> - `backend/src/metrics.ts`: in-process `incrementCounter`/`getCounter`, `recordLatency`/`getLatencyP95` (p95 over a rolling sample window), `recordReplyOutcome`/`getFallbackRate` (rolling per-hour fallback rate), and `getHealthSnapshot()` exposed on the health endpoint. Mirror the shape for Poppy's LLM + media outcomes.
> - `frontend/next.config.ts`: the `securityHeaders` array (HSTS with preload, X-Content-Type-Options nosniff, X-Frame-Options DENY, COOP, Referrer-Policy, Permissions-Policy, and a full Content-Security-Policy with dev-only `'unsafe-eval'`), plus `withSentryConfig` wrapping and the `/api/(.*)` no-store cache header. Adapt the CSP allowlist to Poppy's providers (OpenRouter, Fal/Replicate, ElevenLabs/Cartesia, S3/CloudFront, adult-friendly payment processor, Sentry).
> - `backend/src/utils/audit.ts`: `writeAuditLog` for the deletion/export audit trail.
>
> Locked decisions (PRD §0): mature-gated web-first PWA on AWS. No em dashes anywhere. TypeScript strict. Zod on every mutation. Server-centric Next.js 16.
>
> GDPR/CCPA deletion must be irreversible and complete (no orphan rows). Export must include messages, memories, characters, conversations, ledger, and profile.

## Build steps

### 1. Settings UI shell: `frontend/app/(app)/settings/`
- `page.tsx`: tabbed settings layout: Profile, Security, Privacy & Safety, Appearance, Data.
- `frontend/components/settings/ProfileForm.tsx`: edit display name, bio, jurisdiction (read-only display; changing region re-triggers phase-11 jurisdiction gating). Zod-validated `PATCH /api/me`.
- `frontend/components/settings/PasswordForm.tsx`: current + new password; posts to `PATCH /api/me` (or a dedicated `POST /api/me/password`), timing-safe verify server-side.
- `frontend/components/settings/SafetyPreferences.tsx`: content-safety preferences (SFW-only toggle, mature opt-in gated by age-verification level from phase 01/11).
- `frontend/components/settings/ThemeToggle.tsx`: light/dark, persisted to `localStorage` + `User` preference; CSS-var design tokens from phase 00.

### 2. Chat/memory management UI: `frontend/components/settings/MemoryManager.tsx`
- List memories via `GET /api/memory` (grouped by character), per-item delete via `DELETE /api/memory/:id`, "clear all for this character", and "export my memory".
- Conversation management: list conversations, delete a conversation (cascades its messages), all using phase-04/05 endpoints.

### 3. Profile + password API: `frontend/app/api/me/route.ts`
- `GET /api/me`: current user profile (no secrets).
- `PATCH /api/me`: Zod-validated partial update (display name, bio, theme, safety prefs, password when present). `writeAuditLog({ action: "account.update" })`.

### 4. Data export: `frontend/app/api/me/export/route.ts` (`POST`)
- `backend/src/account/export.ts` → `buildUserExport(userId): Promise<UserExportBundle>`: gathers `User` profile, all `Conversation` + `Message`, all `Memory` + `MemorySummary`, owned `Character` + `CharacterVersion` + `AppearanceSheet` + `VoiceProfile`, `TokenLedger`, `Subscription`, `RelationshipState`, and `MediaAsset` metadata (S3 keys, not blobs). Returns a single JSON bundle.
- Route streams it as a downloadable `application/json` attachment. `track("data_exported", {}, userId)` + `writeAuditLog({ action: "account.export" })`. Gate behind auth + rate limit.

### 5. Account deletion: `frontend/app/api/me/route.ts` (`DELETE`)
- `backend/src/account/delete.ts` → `deleteUserCascade(userId)`: inside a Prisma transaction, delete every user-owned row in FK-safe order: `Message`, `Memory`, `MemorySummary`, `RelationshipState`, `Conversation`, `TokenLedger`, `Subscription`, `MediaAsset` (plus enqueue S3 object deletion), owned `Character` + `CharacterVersion` + `AppearanceSheet` + `VoiceProfile`, `AgeVerification`, `CrisisEvent`, then `User`.
- Retention exception: `AuditLog` rows are anonymized (userId nulled), not deleted, for legal/SB 243 accountability; document this in a comment.
- Irreversible: require re-auth/confirmation, `writeAuditLog({ action: "account.delete" })` (before nulling), `track("account_deleted", {}, userId)`, clear the auth cookie. Frontend `DeleteAccountDialog.tsx` with typed confirmation.

### 6. Analytics tracker + taxonomy: `backend/src/analytics/tracker.ts` + `packages/shared/src/analytics.ts`
- Mirror Pellow `track()`. Define the event taxonomy as a typed union in `packages/shared`: `signup`, `age_verified`, `chat_started`, `message_sent`, `memory_written`, `voice_generated`, `image_generated`, `subscribe`, `token_purchase`, `crisis_event`, `character_created`, `character_published`.
- Fire events at their source (signup route, age gate, chat pipeline, memory extractor, voice/image jobs, billing webhook, publish route). `crisis_event` already fired in phase 11.

### 7. Metrics counters: `backend/src/metrics.ts`
- Mirror Pellow: `incrementCounter`/`getCounter`, `recordLatency`/`getLatencyP95`, and a Poppy-specific `recordProviderOutcome({ provider, success })` for LLM provider outcomes and `recordMediaJobOutcome({ kind, status })` for image/voice jobs, plus rolling fallback-rate helpers.
- `getHealthSnapshot()` exposes counters + p95 latencies. Wire it into the backend health endpoint (`GET /healthz`) added in phase 00/13.

### 8. Sentry: frontend + backend
- Frontend: `@sentry/nextjs` via `frontend/sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, and wrap `next.config.ts` with `withSentryConfig` (mirror Pellow, `tunnelRoute: "/monitoring"`). `SENTRY_DSN` from env (PRD §14 catalog).
- Backend: `@sentry/node` init in `backend/src/index.ts`; capture unhandled rejections and pipeline errors. Add a `GET /api/_debug/throw` (dev-only, flag-gated) that throws a test error to verify capture.

### 9. Security headers: `frontend/next.config.ts`
- Add the `securityHeaders` array mirroring Pellow: HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (`microphone=(self)` for voice notes), and a full CSP. Adapt `connect-src`/`img-src`/`frame-src` to Poppy providers: OpenRouter, Fal/Replicate, ElevenLabs/Cartesia, CloudFront/S3 media host, the adult-friendly payment processor, and `*.sentry.io`. Keep `'unsafe-eval'` dev-only. Add the `/api/(.*)` `no-store` cache header.

## Test instructions
Vitest (`backend/src/account/__tests__/`, `backend/src/analytics/__tests__/`):
- `npm run test -w backend -- export`: `buildUserExport` returns a bundle containing the seeded user's messages, memories, and characters.
- `npm run test -w backend -- delete`: `deleteUserCascade` removes every user-owned row across all tables (assert zero rows remain per table); `AuditLog` rows are anonymized, not deleted.
- `npm run test -w backend -- tracker`: each taxonomy event fires with the correct name and props (mock `prisma.analyticsEvent.create`).

Playwright (`frontend/e2e/`):
- `npx playwright test settings-persist`: change theme + a safety preference; reload; the change persists.
- `npx playwright test data-export`: trigger export; a JSON file downloads.
- `npx playwright test account-delete`: confirm deletion; user is logged out and cannot log back in.

Manual:
- Hit `/api/_debug/throw` in dev and confirm the error appears in Sentry.
- `curl -sI http://localhost:3000/ | grep -iE "strict-transport|x-frame|content-security"` shows the headers.

## Sanity checklist
- [ ] Deletion is irreversible and complete: no orphan rows in any user-owned table after `deleteUserCascade`.
- [ ] Export bundle includes messages + memories + characters (plus conversations, ledger, profile).
- [ ] Sentry captures a thrown test error on both frontend and backend.
- [ ] Security headers (CSP, HSTS, X-Frame-Options) present in the HTTP response.
- [ ] All taxonomy events fire from their source with correct props.
- [ ] Metric counters record LLM provider + media job outcomes and latency; `getHealthSnapshot()` exposes them.
- [ ] Settings changes persist across reload.

## Done criteria
All Vitest account/analytics suites and the three Playwright settings tests pass. Export and delete work end to end with the cascade verified. Sentry captures errors on both tiers. Security headers verified in the response. Analytics taxonomy and metrics counters are wired at their sources. No em dashes in any added file.

## Guardrail note
This phase is code + local tests only. Do **not** commit, push, run any migration against a non-local database, or deploy. Any such action requires a fresh, explicit, per-action human approval. Never run `DELETE /api/me` or the export against a non-local database during development. If a schema change is needed, generate the migration locally and STOP for approval before applying it anywhere non-local.
