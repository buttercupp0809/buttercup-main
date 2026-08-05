# Phase 16: Auth polish (Google signup + password UX)

## Goal
Polish the auth surface without regressing compliance capture. Add: (a) a show/hide eye toggle on every password field (signup, login, and any future password-change form); (b) a real-time password-strength checklist (>=12 chars, uppercase, lowercase, digit, symbol) with per-rule pass/fail ticks and a strength bar, with submit disabled until the required checks pass; (c) a strengthened shared Zod password schema in `packages/shared/src/dto/auth.ts` that requires upper + lower + digit + symbol (min 12) as the SINGLE source of truth used by both client and server, while LOGIN stays lenient so existing users with old-rule passwords can still sign in; (d) the Google Identity Services (GIS) button wired into signup + login, calling the existing `/api/auth/oauth/google` route, then routing new users through the age gate when the route returns `needsAgeGate`. Document the required `GOOGLE_CLIENT_ID` env var.

This phase covers PRD (`prds/experience-monetization-prd.md`) §2.2 (auth: signup via email/password AND Google; password show/hide + real-time strength checklist; password-rule upgrade shared client+server; login stays lenient for existing users; DOB + jurisdiction + ToS/Privacy still captured).

## Prerequisites
- Existing shared schema: `packages/shared/src/dto/auth.ts` has `SignupDto` with a `passwordField` currently requiring min 12 + at least one letter + one digit. Existing tests: `packages/shared/src/dto/auth.test.ts` (its `base.password = "correcthorse4battery"` will FAIL the new rule and must be updated to a symbol+uppercase password).
- Existing signup UI: `frontend/app/signup/page.tsx` (has an `errorMessage` helper and captures email, password, dob, jurisdiction, tosAccepted, privacyAccepted). Do NOT regress any of that.
- Existing login UI: `frontend/app/login/page.tsx` (email + password + `next`/`error` query handling in a Suspense boundary).
- Existing Google backend route is REAL: `frontend/app/api/auth/oauth/google/route.ts`. It returns `501 google_oauth_not_configured` when `GOOGLE_CLIENT_ID` is unset, verifies the GIS ID token against Google JWKS with `audience = GOOGLE_CLIENT_ID`, upserts the user, sets the auth cookie, and returns `{ userId, needsAgeGate }`. The frontend GIS button is MISSING.
- `GoogleOAuthDto` (in the same auth DTO file) already validates `{ idToken }`.

## Context to paste into Cursor
```
You are building Phase 16 of "ButterCupp" (mature-gated AI companion platform): auth polish. Google signup/login button + password show/hide + real-time strength checklist + a stronger shared password schema.

Authoritative spec: prds/experience-monetization-prd.md §2.2. Requirements:
- Signup supports email/password AND Google (GIS button). Keep DOB + jurisdiction + ToS/Privacy capture (compliance) exactly as-is.
- Password field: show/hide eye toggle; real-time strength checklist (>=12 chars, uppercase, lowercase, digit, symbol) with per-rule pass/fail ticks + a strength bar. Submit is disabled until all REQUIRED checks pass.
- Password-rule upgrade in packages/shared/src/dto/auth.ts: require upper + lower + digit + symbol, min 12. Client AND server share the SAME schema (single source of truth). LOGIN keeps the lenient rule so existing users with old-rule passwords still sign in.
- Edge cases: existing users with old passwords still log in; a future reset flow will enforce the new rule.

Wire the Google button to the EXISTING backend route frontend/app/api/auth/oauth/google/route.ts:
- The route already: returns 501 "google_oauth_not_configured" when GOOGLE_CLIENT_ID is unset; verifies the GIS ID token (audience = GOOGLE_CLIENT_ID); upserts the user; sets the auth cookie; returns { userId, needsAgeGate }.
- The button must POST { idToken } (matching GoogleOAuthDto) and, on success, route to /age-gate when needsAgeGate is true, else to /dashboard (or the login `next` param). When GOOGLE_CLIENT_ID is not configured, HIDE the button (or show a disabled "Google sign-in not configured" state); do not render a broken GIS widget.

Hard rules: TypeScript strict; every mutation validated with the shared Zod DTO; no em dashes; server-centric Next.js 16 App Router; keep the age gate + DOB/jurisdiction/ToS capture intact; do NOT weaken login for existing users.
Do NOT run git commit/push, deploy, or migrate a non-local DB.
```

## Build steps

### 1. Strengthen the shared password schema (single source of truth)
- `packages/shared/src/dto/auth.ts`. Replace the current `passwordField` refine with the strong rule and export the rule set so the client can reuse it:
  - Export `PASSWORD_MIN = 12` and a `PASSWORD_RULES` array of `{ id, label, test: (s: string) => boolean }` for: `min` (`s.length >= PASSWORD_MIN`), `upper` (`/[A-Z]/`), `lower` (`/[a-z]/`), `digit` (`/\d/`), `symbol` (`/[^A-Za-z0-9]/`).
  - Rebuild `passwordField` as `z.string().max(200).superRefine(...)` (or chained refinements) that fails unless EVERY rule in `PASSWORD_RULES` passes, with a clear per-rule message. `SignupDto` uses this strong field.
  - Add a separate lenient `loginPasswordField = z.string().min(1).max(200)` and keep `LoginDto` on it. Login must accept ANY existing password so old users are not locked out. Add a code comment explaining why login is intentionally lenient.
  - Export `PASSWORD_RULES`, `PASSWORD_MIN`, and a helper `passwordChecklist(s: string)` returning `PASSWORD_RULES.map(r => ({ id, label, ok: r.test(s) }))` so the UI and the schema share ONE rule definition. Do not duplicate the regexes in the frontend.
- Confirm these are re-exported through `packages/shared/src/dto/index.ts` / `packages/shared/src/index.ts` (the file already does `export * from "./dto"`).

### 2. Update the shared schema tests
- `packages/shared/src/dto/auth.test.ts`. Update the `base.password` from `"correcthorse4battery"` (no uppercase, no symbol) to a value that passes the new rule, e.g. `"Correct-horse4Battery"`. Add cases: a password missing a symbol is rejected; missing uppercase rejected; missing digit rejected; under-12 rejected; a fully-valid password accepted. Add a test that `LoginDto` still accepts a short/legacy password like `"oldpw"` (proving login stays lenient). Add a unit test for `passwordChecklist(...)` returning the right `ok` flags for a mixed input.

### 3. Reusable password field component
- `frontend/components/auth/PasswordField.tsx`. A controlled input with a show/hide eye toggle (button toggles `type` between `password` and `text`, `aria-pressed`, `aria-label` "Show password" / "Hide password"). Props: `value`, `onChange`, `label`, `autoComplete`, and optional `showChecklist?: boolean`. When `showChecklist`, render `frontend/components/auth/PasswordChecklist.tsx` below it.
- `frontend/components/auth/PasswordChecklist.tsx`. Import `passwordChecklist` and `PASSWORD_RULES` from `@buttercupp/shared`. Render each rule as a row with a pass (check) / fail (dot) icon + label, plus a strength bar whose fill = fraction of rules passing (color ramps weak -> strong). Expose the boolean "all required rules pass" to the parent (via a callback prop `onValidityChange(valid: boolean)` or by the parent recomputing from the same helper). ARIA: the checklist is an `aria-live="polite"` region so screen readers hear updates; each row conveys its pass/fail state to assistive tech (not color alone).

### 4. Google Identity Services button
- `frontend/components/auth/GoogleButton.tsx`. Client component that renders the GIS button and calls the existing backend route.
  - Read `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID` (see step 6). If unset, render nothing OR a disabled "Google sign-in not configured" note; never render a broken widget.
  - Load the GIS script (`https://accounts.google.com/gsi/client`) once (guard against double-injection). Initialize `google.accounts.id` with the client id and a callback that receives the `credential` (the ID token).
  - On credential: POST `{ idToken: credential }` to `/api/auth/oauth/google`. On 200, read `{ needsAgeGate }` and `router.push(needsAgeGate ? "/age-gate" : dest)` where `dest` is the login `next` param or `/dashboard`. On 501, surface a small "Google sign-in is not available right now" message. On 401, surface a generic failure.
  - Prop `dest?: string` so login can pass its `next` target and signup can default to `/dashboard`.

### 5. Wire the components into signup + login
- `frontend/app/signup/page.tsx`. Replace the raw password `<input>` with `<PasswordField ... showChecklist />`. Track a `passwordValid` boolean from the checklist and disable the "Create account" button unless `passwordValid` is true (in addition to the existing `busy` guard). Add the `<GoogleButton />` above or below the form with an "or" divider. Keep DOB, jurisdiction, tosAccepted, privacyAccepted, the ToS/Privacy links (Phase 15), and the existing `errorMessage` handling exactly as they are. Update the helper label text from "min 12 chars, letters + digits" to reflect the new rule (the checklist is the real guide).
- `frontend/app/login/page.tsx`. Swap the password `<input>` for `<PasswordField>` WITHOUT the checklist (`showChecklist` omitted): login must not nag existing users about strength. Add `<GoogleButton dest={params.get("next") ?? "/dashboard"} />`. Keep the Suspense boundary and the `error`/`next` query handling.
- (Optional, if a password-change form exists) apply `PasswordField` + checklist there too; if it does not exist yet, skip and note it for the future reset flow.

### 6. Env documentation
- The backend route reads `GOOGLE_CLIENT_ID` (server, already used for JWKS audience). The client button needs the same value exposed to the browser as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Add BOTH to `.env.example` (or the repo's env template) with a comment: same Google OAuth client id, one server-side, one public. Document in the phase notes / a comment that without `GOOGLE_CLIENT_ID` the route returns 501 and the button hides itself, so email/password signup is unaffected. Do NOT hardcode a client id; do NOT write secrets to any non-local env.

## Test instructions
```
# Unit (Vitest): from repo root
npm test -- auth        # updated packages/shared/src/dto/auth.test.ts covers:
# - SignupDto rejects: under-12, missing upper, missing lower, missing digit, missing symbol
# - SignupDto accepts a strong password (>=12 with upper+lower+digit+symbol)
# - LoginDto still accepts a short/legacy password (login stays lenient; existing users not locked out)
# - passwordChecklist(input) returns correct ok flags per rule

# E2E (Playwright): from repo root, dev server auto-starts
npm run test:e2e -- auth-google-password    # add e2e/auth-google-password.spec.ts covering:
# - the eye toggle flips the password input type between password and text (assert the type attribute)
# - typing a weak password shows failing checks and keeps the signup submit button DISABLED
# - typing a strong password ticks all checks and ENABLES the submit button
# - DOB, jurisdiction, and both ToS/Privacy checkboxes are still present and required on signup
# - with NEXT_PUBLIC_GOOGLE_CLIENT_ID set, the Google button renders on signup + login;
#   with it unset, the button is hidden / disabled (no broken widget)

# Manual
npm run dev:frontend   # /signup: toggle the eye, watch the checklist + strength bar live, confirm submit unlocks only when strong
```

## Sanity checklist
- [ ] `packages/shared/src/dto/auth.ts` is the SINGLE source of truth: signup client + server both validate against `PASSWORD_RULES`; the frontend imports the rules/helper rather than redefining regexes.
- [ ] New signup rule requires min 12 + upper + lower + digit + symbol; login stays lenient (any existing password still signs in).
- [ ] Show/hide eye toggle works on signup + login (and password-change if present), with proper `aria-label` / `aria-pressed`.
- [ ] Real-time checklist shows per-rule pass/fail ticks + a strength bar; signup submit is disabled until required checks pass; the checklist is an `aria-live` region and does not rely on color alone.
- [ ] Google button POSTs `{ idToken }` to the existing `/api/auth/oauth/google`, routes to `/age-gate` when `needsAgeGate` is true else `/dashboard` (or login `next`); it hides/disables cleanly when `GOOGLE_CLIENT_ID` is not configured.
- [ ] DOB, jurisdiction, ToS, and Privacy capture on signup are unchanged; the existing `errorMessage` handling is untouched; login Suspense + `next`/`error` handling intact.
- [ ] `GOOGLE_CLIENT_ID` (server) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (client) are documented in the env template; no client id or secret is hardcoded or written to a non-local env.
- [ ] `npm test -- auth` passes with the updated cases; no em dashes in the diff.

## Done criteria
Signup enforces a strong password (min 12, upper+lower+digit+symbol) with a live checklist and eye toggle, backed by one shared Zod schema used on both client and server, while existing users still log in with their old passwords. A configured Google button on signup and login authenticates through the existing backend route and sends new users through the age gate. Compliance capture (DOB, jurisdiction, ToS, Privacy) is fully preserved. All Vitest + Playwright checks above pass locally.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy, or migration against a non-local database. Do not write `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to any hosted or non-local environment; local `.env` only. Local unit/E2E tests and dev servers are fine. When unsure whether an action is prod-touching, assume it is and ask first.
