# Phase 29: First-Login Consent Modal

## Goal
Turn the existing first-login consent overlay into a **server-enforced, versioned
consent gate** that cannot be bypassed. Today `frontend/app/(protected)/layout.tsx`
computes a `needsConsent` boolean (from `ageVerifiedAt` / `ageVerificationLevel` /
`tosAcceptedAt` / `privacyAcceptedAt`) and renders `ConsentGate`
(`frontend/components/app-shell/ConsentGate.tsx`), which posts to
`/api/age/verify` to accept and `/api/auth/logout` to decline. That flow works
but has three gaps this phase closes: (1) there is **no policy version**, so a
user who accepted once never sees the modal again even after the Terms or Privacy
Policy change; (2) accept and decline share the age-gate endpoint, which conflates
the age-gate page and the entry consent modal and records no explicit consent
event; (3) the client sets a `consent_v1` cookie and calls `router.refresh()`,
which means a stale or hand-set cookie plus a client-only check could let a user
past the modal without the server ever recording consent.

This phase: adds an **additive, nullable** consent-version model
(`consentAcceptedAt` + `acceptedPolicyVersion` on `User`, or reuse of the
existing `tosAcceptedAt`/`privacyAcceptedAt` plus a new `acceptedPolicyVersion`)
so the modal shows exactly once per policy version; adds a dedicated
Zod-validated **accept** server action / API route that records consent and the
current `POLICY_VERSION`; adds a dedicated **decline** route that clears the auth
cookie server-side and redirects to `/login` (auto-logout); and makes the gate
**server-authoritative** so the modal blocks the app on first login (or after a
version bump) and cannot be dismissed or bypassed by direct navigation, a client
cookie, or an API call that skips the modal. Accept -> enter the product.
Decline -> auto-logout to `/login`.

Reference: PRD §2.1 (legal pages the modal links to), §5.1 / §12 (age + ToS +
privacy acceptance before any character interaction, SB 243 disclosure). Builds
directly on Phase 01 (`requireAuth`, `requireAgeVerified`, `/api/age/verify`),
Phase 15 (the real `/legal/terms`, `/legal/privacy`, `/legal/cookie` pages), and
the already-present `ConsentGate` + `(protected)/layout.tsx`.

## Prerequisites
- Phase 01 green: cookie JWT auth (`frontend/lib/auth.ts`: `requireAuth`,
  `requireAgeVerified`, `getAuthUserId`, `signAuthToken`, `setAuthCookie`,
  `clearAuthCookie`), `AUTH_COOKIE = "buttercupp_auth"`, `frontend/middleware.ts`
  (protected-path redirect to `/login`, age gate deferred to the layout because
  edge cannot reach Prisma), `frontend/app/(auth)/age-gate/page.tsx`,
  `frontend/app/api/age/verify/route.ts`.
- Phase 15 green: `/legal/terms`, `/legal/privacy`, `/legal/cookie` resolve
  (the modal deep-links to these). If Phase 15 has not shipped, the links still
  render; they just 404 until it does.
- Existing scaffold to formalize (do NOT rewrite from scratch, extend it):
  `frontend/components/app-shell/ConsentGate.tsx` and the `needsConsent`
  computation in `frontend/app/(protected)/layout.tsx`.
- `User` model already has `ageVerifiedAt`, `ageVerificationLevel`,
  `tosAcceptedAt`, `privacyAcceptedAt` (`packages/database/prisma/schema.prisma`).
- `@buttercupp/shared` Zod DTOs live in `packages/shared/src/dto/`
  (`auth.ts` exports `AgeGateDto`, `computeAgeYears`, `MIN_AGE_YEARS`).
- `frontend/lib/api-helpers.ts` (`jsonOk`, `jsonError`, `parseJson`).
- Local Postgres reachable via `DATABASE_URL`; migrations run LOCALLY only.

## Context to paste into Cursor
```
You are implementing Phase 29 of ButterCupp (mature-gated AI companion platform):
the First-Login Consent Modal. Authoritative spec: prds/master-prd.md §5.1 + §12
(age + ToS + privacy acceptance before any character interaction) and §2.1 (the
/legal pages linked from the modal).

WHAT THIS IS: a BLOCKING, SERVER-ENFORCED consent gate shown the first time a user
enters the product, and again whenever they have not accepted the CURRENT policy
version. It requires acceptance of three things together: Terms of Service, the
Privacy Policy, and the 18+/age criteria. It is DISTINCT from:
  - the signup checkboxes (a signup-time convenience, client-trusted),
  - the /age-gate page (a full-page DOB capture flow),
and it must not be bypassable by either of those or by direct URL navigation.

BEHAVIOR CONTRACT (exact):
  - ACCEPT -> record consent (consentAcceptedAt = now, acceptedPolicyVersion =
    current POLICY_VERSION, and the age/tos/privacy stamps) server-side, then let
    the user INTO the product. The modal never reshows for that same policy
    version.
  - DECLINE -> the server CLEARS the auth cookie (session ends) and the user is
    redirected to /login. This is an auto-logout. A declined user who hits any
    protected route is unauthenticated and bounces to /login via middleware.
  - POLICY VERSION -> a single source-of-truth constant POLICY_VERSION (e.g.
    "2026-08-15"). The modal shows when the user's acceptedPolicyVersion !== the
    current POLICY_VERSION (covers first login: null; and version bumps: stale).
    Bumping POLICY_VERSION re-prompts every user exactly once.

ENFORCEMENT (load-bearing): the gate is decided on the SERVER from the User row,
in the (protected) route-group layout, NOT from a client cookie. A client cookie
or client state may make the UI feel instant, but it MUST NOT be what lets a user
past the gate. The server re-checks on every protected navigation. Middleware
stays auth-only (edge cannot read Prisma); the consent check lives in the layout,
same split the age gate already uses.

Hard rules: TypeScript strict; the accept mutation is validated with a Zod DTO
from @buttercupp/shared; no em dashes anywhere; server-centric Next.js 16 App
Router; import { prisma } from "@buttercupp/database" (never new PrismaClient()).
Do NOT run git commit/push, deploy, or migrate a non-local DB. Local prisma
migrate + local tests + local dev server are fine.
```

## Build steps

### 1. Policy-version constant + consent shape: `frontend/lib/consent.ts` (new)
- Export `POLICY_VERSION` as a single literal string (e.g. `"2026-08-15"`). This
  is the ONE place the current policy version is defined; the modal, the accept
  route, and the layout check all import it. Add a top comment: "Bump this
  whenever Terms or Privacy Policy materially change; every user is re-prompted
  exactly once on their next protected navigation."
- Export a pure `needsConsent(user)` predicate that returns `true` when the user
  has NOT accepted the current policy version. It is the single source of truth
  the layout uses, replacing the inline boolean in `(protected)/layout.tsx`:
  ```ts
  export function needsConsent(u: {
    ageVerifiedAt: Date | null;
    ageVerificationLevel: string;
    tosAcceptedAt: Date | null;
    privacyAcceptedAt: Date | null;
    acceptedPolicyVersion: string | null;
  }): boolean {
    const ageOk =
      u.ageVerifiedAt !== null &&
      u.ageVerificationLevel !== "none" &&
      u.tosAcceptedAt !== null &&
      u.privacyAcceptedAt !== null;
    return !ageOk || u.acceptedPolicyVersion !== POLICY_VERSION;
  }
  ```
  Keep the age criteria in the same predicate so age + ToS + privacy + version are
  one gate, not four scattered checks.

### 2. Prisma schema (additive, nullable, local migration only)
In `packages/database/prisma/schema.prisma`, `model User`, add two additive,
nullable columns:
```
consentAcceptedAt      DateTime?
acceptedPolicyVersion  String?
```
- Both nullable so existing rows are valid without a backfill; a null
  `acceptedPolicyVersion` means "never accepted the current version" and the modal
  shows. Do NOT drop or repurpose `tosAcceptedAt` / `privacyAcceptedAt` /
  `ageVerifiedAt` / `ageVerificationLevel`; the new columns sit alongside them
  (the accept route stamps all of them together).
- Generate the migration `--create-only --name add_user_consent_version` and apply
  it LOCALLY only (`prisma migrate dev`). Never target a non-local DB. STOP for
  approval before applying anywhere hosted.

### 3. Accept: Zod DTO + `frontend/app/api/consent/accept/route.ts` (new)
- DTO in `packages/shared/src/dto/consent.ts` (export from
  `packages/shared/src/index.ts`): `ConsentAcceptDto` with
  `{ policyVersion: string, tosAccepted: true, privacyAccepted: true, ageConfirmed: true }`.
  Use Zod literals (`z.literal(true)`) so a request with any box unchecked fails
  validation at the boundary; `policyVersion` is `z.string().min(1)`.
- Route (`runtime = "nodejs"`): `getAuthUserId()`; 401 if none. `parseJson(req,
  ConsentAcceptDto)`. Reject with 409 `stale_policy_version` if the submitted
  `policyVersion !== POLICY_VERSION` (defends against a stale modal accepting an
  old version). On success, update the user in one write:
  ```ts
  const now = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: {
      consentAcceptedAt: now,
      acceptedPolicyVersion: POLICY_VERSION,
      tosAcceptedAt: now,
      privacyAcceptedAt: now,
    },
  });
  ```
  Do NOT stamp `ageVerifiedAt` / `ageVerificationLevel` here if the user has never
  been through the age gate: if `ageVerifiedAt` is still null, treat the modal's
  age checkbox as a self-declared confirmation and stamp
  `ageVerifiedAt = now, ageVerificationLevel = "self_declared"` (this modal is the
  entry gate, so it may be the first age confirmation). Keep this consistent with
  how `/api/age/verify` records self-declared verification. Return `jsonOk()`.
- This route is the single consent-recording choke point. It does NOT trust any
  client cookie; the DB row is the record.

### 4. Decline / auto-logout: `frontend/app/api/consent/decline/route.ts` (new)
- Route (`runtime = "nodejs"`, POST): no body needed. Build the response, call
  `clearAuthCookie(res)` (same helper `logout` uses), and return
  `jsonOk({ redirect: "/login" })`. The client then navigates to `/login`.
  Server-side cookie clearing is what makes decline a real auto-logout: after
  this call the session cookie is gone, so middleware bounces every protected
  route to `/login`.
- Rationale for a dedicated route (not reusing `/api/auth/logout`): decline is a
  consent-refusal event, distinct from a normal sign-out, and keeping it separate
  lets us `track`/audit refusals later without conflating them with logout. The
  cookie-clearing mechanics are identical; import the same `clearAuthCookie`.

### 5. Modal component: formalize `frontend/components/app-shell/ConsentGate.tsx`
- Keep the existing blurred-shell overlay design; change what it talks to:
  - Accept posts to `POST /api/consent/accept` with
    `{ policyVersion: POLICY_VERSION, tosAccepted, privacyAccepted, ageConfirmed }`
    (import `POLICY_VERSION` from `@/lib/consent`). Add an explicit "I confirm I am
    18 or older" checkbox so `ageConfirmed` is a real user action (today the modal
    only has ToS + Privacy + DOB). Keep the DOB field if desired, but the three
    literal-true booleans are what the DTO requires.
  - On accept success call `router.refresh()` so the SERVER layout re-evaluates
    `needsConsent(user)` against the freshly written row and unmounts the gate.
    REMOVE the `document.cookie = "consent_v1=1..."` line: the client cookie must
    not be the thing that dismisses the gate (the server row is). If a client hint
    is wanted for perceived speed, it may set local component state, but the
    authoritative dismissal is the server re-render.
  - Decline posts to `POST /api/consent/decline`, then `router.push("/login")`
    (or follows the returned `redirect`). Keep the "Decline and sign out" button.
  - Links go to the real `/legal/terms`, `/legal/privacy`, `/legal/cookie` pages
    (Phase 15), `target="_blank" rel="noopener noreferrer"` so opening them does
    not lose the modal.
  - Add `data-testid="consent-modal"` on the overlay and stable testids on the
    accept button (`consent-accept`) and decline button (`consent-decline`) for
    Playwright.
- The overlay must be non-dismissible: no close button, no click-outside-to-close,
  no escape-to-close. The only exits are Accept (enter) and Decline (logout).

### 6. Server enforcement: `frontend/app/(protected)/layout.tsx`
- Replace the inline `needsConsent` boolean with the imported
  `needsConsent(user)` from `@/lib/consent` (step 1), passing the user row
  (which now includes `acceptedPolicyVersion`). `requireAuth()` still runs first.
- Because the layout is a Server Component that reads the fresh `User` row on
  every protected navigation, a user with `needsConsent === true` ALWAYS gets the
  gate regardless of how they arrived (direct `/chat` URL, back button, client
  cookie). This is the bypass-proof enforcement: the modal is rendered by the
  server, not gated behind client state.
- Do NOT loosen `requireAgeVerified()` usage elsewhere. Note that `/age-gate`
  itself is NOT under `(protected)` (it would loop), so the consent modal and the
  age-gate page do not fight; a user who lands on the age-gate page and completes
  it will still hit the consent modal on entry if their `acceptedPolicyVersion` is
  stale, and vice versa. If you want to avoid a double prompt, have the accept
  route stamp the age fields (step 3) so one acceptance satisfies both.
- Optional hardening: add a `requireConsent()` helper in `frontend/lib/auth.ts`
  (mirrors `requireAgeVerified`) that server-side `redirect`s or the layout uses
  `needsConsent`; either is acceptable as long as the decision is server-made.

### 7. Middleware note (no functional change)
- `frontend/middleware.ts` stays auth-only for the consent gate (edge cannot read
  Prisma, same reason the age gate is layout-enforced). Add a one-line comment
  next to the existing age-gate comment documenting that consent-version
  enforcement also lives in the `(protected)` layout, not the edge. `matcher`
  already covers the protected prefixes; no change needed.

## Test instructions
```
# Unit (Vitest): from repo root
npm test -- consent        # covers:
# - needsConsent(user): returns true when acceptedPolicyVersion is null (first
#   login); true when acceptedPolicyVersion is an OLD version (bump case);
#   false only when age stamps are present AND acceptedPolicyVersion === POLICY_VERSION.
# - ConsentAcceptDto: a payload with tosAccepted:false (or privacyAccepted:false,
#   or ageConfirmed:false) FAILS parse; the all-true payload passes.
# - accept handler logic: submitting a policyVersion !== POLICY_VERSION yields the
#   409 stale_policy_version branch; a matching version writes consentAcceptedAt +
#   acceptedPolicyVersion (+ age self-declared stamp when ageVerifiedAt was null).
# - decline handler: the response clears the auth cookie (maxAge 0 on buttercupp_auth).

# E2E (Playwright): from repo root, dev server auto-starts
npm run test:e2e -- consent-modal      # covers:
# - FIRST LOGIN SHOWS MODAL: a freshly authenticated user (acceptedPolicyVersion
#   null) landing on /dashboard sees [data-testid="consent-modal"] blocking the app.
# - DECLINE LOGS OUT: clicking consent-decline clears the session and lands on
#   /login; re-visiting /dashboard redirects to /login (session really ended).
# - ACCEPT ENTERS + NO RESHOW: checking ToS + Privacy + 18+ and clicking
#   consent-accept dismisses the modal, shows the app, and a full reload of
#   /dashboard does NOT reshow the modal (persisted for POLICY_VERSION).
# - DIRECT-URL BYPASS BLOCKED: an authenticated-but-not-consented user navigating
#   directly to /chat (or /create) still gets the modal, not the feature.
# - VERSION BUMP RESHOWS (optional): with the user's acceptedPolicyVersion set to
#   an old string, the modal reappears on next navigation, and re-accepting clears it.
```
Manual:
```
npm run dev:frontend
# 1. Log in as a user who has never accepted (or null out acceptedPolicyVersion
#    in local Postgres). Visit /dashboard -> the modal blocks the app.
# 2. Click "Decline and sign out" -> you land on /login; try to open /chat -> it
#    bounces to /login (cookie cleared server-side).
# 3. Log back in, accept all three -> you enter; reload -> no modal.
# 4. In psql, bump POLICY_VERSION (or set the user's acceptedPolicyVersion to an
#    old value) -> reload -> modal reappears once, accept clears it.
# 5. Try to skip: with acceptedPolicyVersion null, type /create directly -> modal.
```

## Sanity checklist
- [ ] On first login (acceptedPolicyVersion null) the consent modal BLOCKS the
      whole app; ToS + Privacy + 18+ must all be checked to accept.
- [ ] Accept records `consentAcceptedAt` + `acceptedPolicyVersion = POLICY_VERSION`
      (and the age/tos/privacy stamps) server-side, then lets the user in; the
      modal NEVER reshows for that same policy version (verified by a full reload).
- [ ] Bumping `POLICY_VERSION` re-prompts every user exactly once on their next
      protected navigation.
- [ ] Decline clears the `buttercupp_auth` cookie SERVER-side and redirects to
      /login; a declined user cannot reach any protected route (middleware bounces
      them to /login because the session is gone).
- [ ] The gate is decided in the `(protected)` Server-Component layout from the
      User row, not from a client cookie; direct navigation to `/chat` / `/create`
      by a non-consented user still shows the modal (no bypass).
- [ ] The removed `consent_v1` client cookie is no longer what dismisses the gate;
      the server row is authoritative.
- [ ] The accept mutation is validated with a `@buttercupp/shared` Zod DTO
      (`z.literal(true)` on each consent box); a request with any box false is
      rejected at the boundary.
- [ ] Modal links resolve to the real `/legal/terms`, `/legal/privacy`,
      `/legal/cookie` pages and open in a new tab without losing the modal.
- [ ] Migration is additive/nullable (`User.consentAcceptedAt`,
      `User.acceptedPolicyVersion`); no existing column changed; applied locally only.
- [ ] `import { prisma } from "@buttercupp/database"` everywhere; no
      `new PrismaClient()`. No em dashes in the diff.

## Done criteria
A first-time user (or any user whose `acceptedPolicyVersion` does not match the
current `POLICY_VERSION`) is stopped by a blocking, non-dismissible consent modal
on entry. Accepting all three (Terms, Privacy, 18+) records versioned consent
server-side and lets them into the product, and the modal never reshows for that
version. Declining clears the session cookie server-side and auto-logs them out to
`/login`. The gate is enforced by the server `(protected)` layout from the User
row, so it cannot be bypassed by direct URL, a client cookie, or a skipped modal.
Bumping `POLICY_VERSION` re-prompts everyone once. All Vitest + Playwright tests
above pass locally, and the migration is additive/nullable and applied only to a
local database.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any
`git commit`, `git push`, deploy, secret write, or migration against a non-local
database. This phase adds `User.consentAcceptedAt` + `User.acceptedPolicyVersion`;
generate the migration locally and apply it ONLY to your local Postgres. Applying
it to any hosted/prod database, or bumping `POLICY_VERSION` in a deployed
environment (which re-prompts real users), requires a fresh, explicit,
per-action approval. Local edits, local `prisma migrate dev`, local tests, and the
local dev server proceed without it. Prior approval never carries to the next action.
