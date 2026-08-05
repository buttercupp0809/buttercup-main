# Phase 01: Auth & age/compliance gate

## Goal
Deliver ButterCupp's identity and mature-gating layer: cookie-based JWT auth via `jose` (httpOnly, Secure, SameSite=Lax, audience-scoped) mirroring `../Pellow/frontend/lib/auth.ts`; email+password signup/login (argon2 or bcrypt hashing), Google OAuth, and optional passwordless magic-link (SHA-256 hashed token at rest, short TTL, timing-safe compare); a Next.js middleware guarding protected routes mirroring `../Pellow/frontend/middleware.ts`; and the AGE & COMPLIANCE GATE (date-of-birth capture, 18+ enforcement, ToS/privacy acceptance, jurisdiction capture) that must pass before any character interaction. Ships the `AgeVerificationProvider` interface (self-declared baseline + vendor-escalation hook) and a persistent AI-disclosure UI scaffold (SB 243). All request/response DTOs are Zod schemas in `@buttercupp/shared`.

This phase covers PRD §5.1 (auth & age verification), §12 (compliance & safety, the age/disclosure parts), and §15 (security).

## Prerequisites
- Phase 00 green: monorepo, `@buttercupp/database` singleton, `@buttercupp/shared`, tooling, Dockerfile.
- Phase 02 (full data model) is NOT required to start, but this phase adds the auth-relevant models. If Phase 02 has not run, add the `User`, `AgeVerification`, and `MagicLink` models here as a forward-compatible subset that Phase 02 will absorb (same field names). Do not duplicate models: if Phase 02 already defined them, extend rather than redeclare.
- Local Postgres reachable via `DATABASE_URL`; run migrations LOCALLY only.
- `JWT_SECRET` set locally to a value >= 32 chars.

## Context to paste into Cursor
```
You are building Phase 01 of "ButterCupp" (mature-gated AI companion platform): auth + the age/compliance gate.

Authoritative spec: prds/master-prd.md. Read:
- §5.1 Auth & age verification (email/password + Google OAuth + magic-link; age & compliance gate before any character interaction; AgeVerificationProvider abstraction; httpOnly cookie JWT via jose, audience-scoped; middleware guards).
- §12 Compliance & safety (SB 243: AI-disclosure default + persistent; age verification baseline self-declared, escalate to vendor per jurisdiction; jurisdiction gating).
- §15 Security (httpOnly Secure SameSite cookies; audience-scoped JWT; timing-safe comparison; short-TTL magic links SHA-256 hashed at rest; server-side Zod validation; assertSafeString/assertSafeId).

Mirror Pellow exactly for auth mechanics:
- ../Pellow/frontend/lib/auth.ts, jose SignJWT/jwtVerify, getSecret() with a fail-closed >=32-char/32-byte guard, per-audience helpers (signAuthToken/verifyAuthToken, plus separate reset/onboarding/billing scopes), cookie set/clear helpers (httpOnly, secure in prod, sameSite, path, maxAge), getAuthUserId/getCurrentUser/requireAuth/requireAuthApi guards.
- ../Pellow/frontend/middleware.ts, edge-runtime middleware: re-implements the same fail-closed secret guard (cannot import lib/auth.ts in edge), verifies the auth cookie on protected paths, redirects unauthenticated users, applies rate-limit + CORS + content-type checks on /api. matcher covers protected + api paths.
- ../Pellow/backend/src/utils/safe-types.ts, assertSafeId/assertSafeString runtime guards for any user value entering a Prisma where.

ButterCupp-specific requirements on top of Pellow:
- Add an AGE & COMPLIANCE GATE that runs after auth but BEFORE any /chat or character interaction. It captures date of birth, enforces 18+, records ToS + privacy acceptance, and captures jurisdiction (country/region). A user who has not passed the gate is redirected to /age-gate from every protected character route, and cannot reach chat by typing the URL directly.
- Add an AgeVerificationProvider interface: baseline "self_declared" implementation now, plus a "vendor_verified" escalation hook (stub) triggered by mature-content access + jurisdiction rules. Persist results in an AgeVerification row and stamp User.ageVerifiedAt / User.ageVerificationLevel.
- Add a persistent AI-disclosure UI scaffold (a always-visible "You are talking to an AI" indicator component) to satisfy SB 243. Wire the component into the app shell; the chat surface (Phase 04) will consume it.
- SameSite for the main auth cookie is Lax (ButterCupp uses OAuth redirects). Keep httpOnly + Secure(in prod). Do NOT store raw magic-link tokens: hash with SHA-256, store the hash, compare timing-safe, short TTL (e.g. 15 min), single-use (consumedAt).

Hard rules: TypeScript strict; every mutation validated with a Zod DTO from @buttercupp/shared; no em dashes; server-centric Next.js 16 App Router; never new PrismaClient() (import { prisma } from "@buttercupp/database").
Do NOT run git commit/push, deploy, or migrate a non-local DB.
```

## Build steps

### 1. Prisma models (local migration only)
In `packages/database/prisma/schema.prisma` add (or extend, if Phase 02 already created them) the auth/age models. Keep field names identical to PRD §8 so Phase 02 does not conflict:
- `User`. `id`, `email @unique`, `passwordHash?`, `googleId? @unique`, `dob DateTime?`, `jurisdiction String?`, `subscriptionTier String @default("free")`, `tokenBalance Int @default(0)`, `ageVerifiedAt DateTime?`, `ageVerificationLevel String @default("none")`, `tosAcceptedAt DateTime?`, `privacyAcceptedAt DateTime?`, timestamps.
- `AgeVerification`. `id`, `userId`, `provider String`, `level String` (`self_declared|vendor_verified`), `status String`, `evidenceRef String?`, `verifiedAt DateTime?`, `createdAt`, relation to `User`, `@@index([userId])`.
- `MagicLink`. `id`, `userId`, `tokenHash String @unique` (SHA-256 hex), `purpose String @default("login")`, `expiresAt DateTime`, `consumedAt DateTime?`, `createdAt`, `@@index([userId, createdAt])`, `@@index([expiresAt])`.
Then run LOCAL migration only: `npm run db:migrate` (prisma migrate dev). Never target a non-local DB.

### 2. Constants + secret guard
- `frontend/lib/constants.ts`. cookie names (`AUTH_COOKIE = "buttercupp_auth"`), TTLs (`TOKEN_MAX_AGE`, `MAGIC_LINK_TTL_S = 900`), `JWT_ISSUER = "buttercupp"`, audiences (`JWT_AUD_AUTH`, `JWT_AUD_RESET`, `JWT_AUD_MAGIC`), `ALLOWED_ORIGINS`.
- `frontend/lib/auth.ts`. port from `../Pellow/frontend/lib/auth.ts`: `getSecret()` fail-closed >= 32-char/32-byte guard; `signAuthToken(userId)` / `verifyAuthToken(token)` (issuer + `JWT_AUD_AUTH`); `setAuthCookie`/`clearAuthCookie` (httpOnly, `secure: isProd()`, `sameSite: "lax"`, path `/`, maxAge `TOKEN_MAX_AGE`); `getAuthUserId()`, `getCurrentUser()`, `requireAuth()` (redirect to `/login`), `requireAuthApi(requestedUserId)` (401/403). Add a `requireAgeVerified()` helper: loads the user, and if `ageVerifiedAt` is null OR gate acceptance is missing, `redirect("/age-gate")`.

### 3. Password + token crypto helpers
- `frontend/lib/password.ts`. `hashPassword` / `verifyPassword` using argon2id (preferred) or bcrypt. Never log plaintext.
- `frontend/lib/magic-link.ts`. generate a random token (crypto.randomBytes), return the raw token to email and store only `sha256(token)`; `verifyMagicLink(rawToken)` hashes the input and does a timing-safe compare against the stored hash, checks `expiresAt` and `consumedAt`, and single-uses it (`consumedAt = now`).

### 4. Zod DTOs in `@buttercupp/shared`
- `packages/shared/src/dto/auth.ts`. `SignupDto` (email, password, dob, jurisdiction, tosAccepted, privacyAccepted), `LoginDto` (email, password), `MagicLinkRequestDto` (email), `AgeGateDto` (dob, jurisdiction, tosAccepted true, privacyAccepted true). Enforce 18+ in `AgeGateDto`/`SignupDto` via a refinement computing age from dob.
- Export from `packages/shared/src/index.ts`. Every API route parses input with these.

### 5. Auth API routes (Next.js App Router)
Under `frontend/app/api/auth/`:
- `signup/route.ts`. parse `SignupDto`; reject under-18 dob; check email uniqueness; hash password; create `User` with `tosAcceptedAt`/`privacyAcceptedAt`/`dob`/`jurisdiction`; if dob present and >=18, create a `self_declared` `AgeVerification` and stamp `ageVerifiedAt` + `ageVerificationLevel="self_declared"`; sign auth token; set cookie; return `{ ok: true }`.
- `login/route.ts`. parse `LoginDto`; load user by email; `verifyPassword`; on success sign token + set cookie. Generic error on failure (no user-enumeration).
- `logout/route.ts`. clear the auth cookie.
- `oauth/google/route.ts`. Google OAuth (GIS ID-token flow like Pellow's `googleId`): verify the Google ID token, upsert user by `googleId`/email, set cookie. New OAuth users with no dob are sent to `/age-gate`.
- `magic-link/route.ts`. POST: parse `MagicLinkRequestDto`, create a `MagicLink` (store hash only, TTL 15 min), "send" the link (log to console locally; email provider wired later). GET `magic-link/consume/route.ts`. verify raw token timing-safe, single-use, set auth cookie, redirect. New magic-link users with no dob go to `/age-gate`.

### 6. Age & compliance gate
- `frontend/app/api/age/verify/route.ts`. parse `AgeGateDto`; requires an authenticated user; reject under-18 dob (compute age server-side); persist `dob`, `jurisdiction`, `tosAcceptedAt`, `privacyAcceptedAt`; create/refresh a `self_declared` `AgeVerification`; stamp `ageVerifiedAt`/`ageVerificationLevel`. Return the escalation decision (whether vendor verification is required for this jurisdiction + mature access).
- `frontend/lib/age-verification/provider.ts`. the `AgeVerificationProvider` interface: `verify(input): Promise<{ level, status, evidenceRef? }>`. Two implementations: `SelfDeclaredProvider` (baseline, always self_declared) and `VendorProvider` (stub throwing "not configured" until a vendor is wired). A `getAgeProvider()` factory reads `AGE_VERIFICATION_PROVIDER` env.
- `frontend/lib/age-verification/jurisdiction.ts`. `requiresVendorVerification(jurisdiction, contentRating)` policy stub (returns false for now; documents where per-region rules go).
- `frontend/app/(auth)/age-gate/page.tsx`. the gate UI: DOB picker, jurisdiction select, ToS + privacy checkboxes with links, submit to `/api/age/verify`. On success route to `/dashboard`. Cannot be skipped.

### 7. Middleware guard
- `frontend/middleware.ts`. port `../Pellow/frontend/middleware.ts`: fail-closed edge secret guard (kept in sync with `lib/auth.ts` getSecret, min 32 chars/bytes); on protected paths (`/dashboard`, `/chat`, `/characters/:id/chat`, `/create`) verify the auth cookie and redirect unauthenticated users to `/login`; add an AGE-GATE check: verifying the cookie yields a userId, but the gate status lives in the DB (edge cannot query Prisma), so guard the age gate at the layout/server-component level via `requireAgeVerified()` and keep middleware to auth + rate-limit + CORS + content-type checks on `/api`. Document this split in a comment. `matcher` covers protected + `/api/:path*`.
- Enforce the gate server-side too: the protected route-group layout (`frontend/app/(protected)/layout.tsx`) calls `requireAuth()` then `requireAgeVerified()`, so a direct URL to `/chat` for an unverified user redirects to `/age-gate`.

### 8. AI-disclosure scaffold (SB 243)
- `frontend/components/ai-disclosure.tsx`. a persistent, always-visible indicator ("You're chatting with an AI"). Include it in the protected app shell so it renders on dashboard + chat. Non-dismissible by default.

## Test instructions
```
# Unit (Vitest): run from repo root
npm test -- auth        # covers:
# - signAuthToken -> verifyAuthToken round-trips; wrong-audience token fails verify
# - getSecret() throws on a <32-char secret (fail-closed)
# - hashPassword/verifyPassword: correct password verifies, wrong rejects
# - magic-link: raw token verifies once, second use rejected (consumed), expired token rejected, timing-safe compare used
# - AgeGateDto/SignupDto: dob making the user 17 is rejected, 18+ accepted; missing tos/privacy rejected

# E2E (Playwright): run from repo root (dev server auto-starts)
npm run test:e2e -- auth-age-gate      # covers:
# - unverified (no age gate) user is BLOCKED from /chat and redirected to /age-gate
# - submitting a DOB under 18 on the age gate is rejected with an error
# - a verified user (18+, tos+privacy accepted) passes the gate and reaches /dashboard, then /chat
# - direct navigation to /chat by an authenticated-but-unverified user redirects to /age-gate (cannot bypass by URL)
# - the AI-disclosure indicator is visible on the protected shell
```

## Sanity checklist
- [ ] Auth cookie is `httpOnly`, `Secure` in prod, `SameSite=Lax`, audience-scoped (`JWT_AUD_AUTH`); a token minted for a different audience fails `verifyAuthToken`.
- [ ] `getSecret()` (and the middleware mirror) fail closed on a short/missing `JWT_SECRET`.
- [ ] Passwords hashed with argon2id/bcrypt; no plaintext logged; login gives a generic error (no user enumeration).
- [ ] Magic-link tokens are SHA-256 hashed at rest, single-use (`consumedAt`), short TTL, timing-safe compared.
- [ ] Middleware redirects unauthenticated users away from protected routes; the protected layout enforces `requireAgeVerified()` so the age gate cannot be bypassed by typing the URL.
- [ ] Under-18 DOB is rejected server-side (age computed on the server, not trusted from the client).
- [ ] `AgeVerification` row + `User.ageVerifiedAt`/`ageVerificationLevel` are stamped on gate pass; the `AgeVerificationProvider` interface exists with `SelfDeclaredProvider` live and `VendorProvider` stubbed.
- [ ] ToS + privacy acceptance timestamps persisted; jurisdiction captured.
- [ ] Persistent AI-disclosure indicator renders on the protected shell (SB 243).
- [ ] Every auth/age API route validates input with a `@buttercupp/shared` Zod DTO; user values entering Prisma `where` pass through `assertSafeId`/`assertSafeString`.
- [ ] `import { prisma } from "@buttercupp/database"` used everywhere; no `new PrismaClient()`.
- [ ] No em dashes in the diff.

## Done criteria
A user can sign up (email/password, Google, or magic-link), is forced through the age & compliance gate before any character interaction, and cannot bypass it by direct URL. Sessions are audience-scoped httpOnly cookie JWTs with a fail-closed secret guard. The `AgeVerificationProvider` abstraction and vendor-escalation hook exist. The AI-disclosure scaffold is wired. All Vitest + Playwright tests above pass locally. Phase 02 can absorb/extend these models, and Phase 04 (chat) can rely on `requireAuth()` + `requireAgeVerified()`.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy, or migration against a non-local database. `npm run db:migrate` is allowed ONLY against your LOCAL Postgres. Local unit/E2E tests and dev servers are fine. When unsure whether an action is prod-touching, assume it is and ask first.
