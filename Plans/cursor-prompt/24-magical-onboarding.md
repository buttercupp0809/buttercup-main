# Phase 24: Magical Onboarding

## Goal
Today signup posts to `/api/auth/signup` and the client immediately does
`router.push("/dashboard")` (see `frontend/app/signup/SignupForm.tsx`), and the
age gate (`frontend/app/(auth)/age-gate/page.tsx` -> `/api/age/verify`) also
lands on `/dashboard`. We never collect a display name, a preferred pronoun, or
any taste signal, so the dashboard greets everyone with a bare email
("Signed in as {user.email}") and the first-companion pick is un-personalized.

This phase adds a NET-NEW, mobile-first, creative onboarding wizard that runs
ONCE, immediately after a user is authenticated AND age-verified, before they
reach `/dashboard`. Max 3 to 4 steps: (1) name + pronoun/gender, (2) taste and
preferences (vibe, interests, what they want from a companion), (3) an OPTIONAL
first-companion recommendation drawn from the existing gallery, (4) a finish
screen that routes to `/dashboard`. It persists a small, additive profile on the
`User` (a `UserProfile` 1:1 model, justified below), gates itself with a
`completedOnboardingAt` flag so it never re-runs, and adds redirect logic (in the
`(protected)` layout, mirroring the existing consent gate) that sends any
authenticated + age-verified user who has NOT completed onboarding to
`/onboarding`. Optionally it seeds the stated preferences as persona-agnostic
memory hints via `writeMemory`.

Reuse the existing wizard pattern verbatim: React state + `localStorage` draft +
`validateStep` from `@buttercupp/shared`, exactly as
`frontend/app/(protected)/create/context.tsx` and `.../create/steps.ts` do. Do
NOT invent a new state library or a new validation approach.

Reference: PRD §2.3 (in-app shell, dark cinematic surfaces), §1 (mature-gated
adult product, onboarding must sit AFTER the age gate), the existing creation
wizard (Phase 06) as the pattern of record.

## Prerequisites
- Phase 01 green: cookie JWT auth, `/api/auth/signup`, age gate
  (`frontend/app/(auth)/age-gate/page.tsx`, `frontend/app/api/age/verify/route.ts`),
  `middleware.ts` (auth-only; age + onboarding are enforced server-side in the
  layout, not the edge, because they need the `User` row).
- Phase 02 green: `User` model with `dob`, `jurisdiction`, `subscriptionTier`,
  `tokenBalance`, `freeMessagesUsed`, `ageVerifiedAt`, `ageVerificationLevel`,
  `tosAcceptedAt`, `privacyAcceptedAt` (`packages/database/prisma/schema.prisma`
  around lines 106 to 137).
- Phase 03 green: gallery + `CharacterCard` / `CharacterGrid`
  (`frontend/components/gallery/`) and the dashboard feed
  (`frontend/lib/feed.ts`, `getDashboardFeed`) for the step-3 recommendation.
- Phase 05 green (only if seeding memory): `backend/src/memory/store.ts`
  (`writeMemory`), `EMBEDDING_DIM = 384`.
- Auth helpers: `frontend/lib/auth.ts` (`requireAuth`, `getAuthUserId`,
  `requireAgeVerified`, `requireAuthApi`), the Prisma singleton
  (`import { prisma } from "@buttercupp/database"`).
- Existing wizard reference: `frontend/app/(protected)/create/context.tsx`,
  `frontend/app/(protected)/create/steps.ts`, and the per-step Zod slices in
  `packages/shared/src/character-create.ts`.

## Context to paste into Cursor
```
You are implementing Phase 24 of ButterCupp: a magical, mobile-first onboarding
wizard that runs ONCE, after signup and after age verification, before the user
first reaches /dashboard.

CURRENT FLOW (do not break it):
- frontend/app/signup/SignupForm.tsx POSTs /api/auth/signup then router.push("/dashboard").
- frontend/app/(auth)/age-gate/page.tsx POSTs /api/age/verify then router.push("/dashboard").
- frontend/app/(protected)/layout.tsx is a server component: it calls requireAuth(),
  computes `needsConsent` (age + ToS + Privacy), and wraps children in <ConsentGate>.
  Middleware (frontend/middleware.ts) is EDGE and only checks the auth cookie; it
  cannot read the User row, so age + onboarding gating live in the layout, not the edge.

NEW FLOW after this phase:
  signup -> age-gate -> /onboarding (steps 1..4) -> /dashboard.
An already-onboarded user (completedOnboardingAt != null) never sees /onboarding again.

DATA MODEL DECISION (pick UserProfile 1:1, justify it):
- Add a `completedOnboardingAt DateTime?` column directly on User (a once-flag,
  queried in the layout on every protected request, so it must be cheap and live
  on User, NOT in a JSON blob).
- Add a separate `model UserProfile` with a 1:1 relation to User, holding:
  displayName, gender/pronoun, plus a `preferences Json?` (vibe, interests[],
  companionGoal). Rationale: (a) profile fields are optional and evolve
  independently of auth/billing fields on User, keeping the hot User row lean;
  (b) a dedicated table lets us index/extend taste fields later without more User
  columns; (c) Json for the free-form taste blob avoids a column explosion while
  the once-per-request gate stays a typed scalar on User. This is additive and
  nullable end to end, so it is a SAFE LOCAL migration (no backfill, no NOT NULL,
  no data loss for existing users).

HARD RULES:
- One PrismaClient. import { prisma } from "@buttercupp/database". Never new PrismaClient().
- TypeScript strict. Zod validates EVERY mutation at the trust boundary (server actions).
- Server-centric Next.js 16 App Router: the wizard shell + persistence use Server
  Actions; only the step inputs are client components (they need onChange state).
- REUSE the create-wizard pattern: React state + localStorage draft + validateStep
  from @buttercupp/shared. Do not add a new state manager.
- Use existing design tokens only: buttercupp-glass, buttercupp-accent-rose,
  buttercupp-accent-violet, buttercupp-scrim, the buttercupp-app dark shell.
- Mobile-first: single column, large tap targets, sticky footer nav, min 3 max 4 steps.
- No em dashes anywhere (commas / periods / parentheses).
- GUARDRAIL: never commit, push, migrate a non-local DB, or deploy without a fresh
  explicit human approval. The additive migration is applied to a LOCAL DB only.
```

## Build steps

1. **Shared Zod schemas + step config: `packages/shared/src/onboarding.ts`** (new)
   - Mirror `character-create.ts`: per-step slice schemas plus a composed schema.
     ```ts
     import { z } from "zod";

     export const ONBOARDING_DRAFT_STORAGE_KEY = "buttercupp:onboarding-draft";

     // Step 1: identity
     export const onboardingIdentitySchema = z.object({
       displayName: z.string().trim().min(1, "Tell us what to call you").max(48),
       gender: z.enum(["woman", "man", "nonbinary", "prefer_not"]),
     });

     // Step 2: taste / preferences
     export const onboardingTasteSchema = z.object({
       vibe: z.enum(["cozy", "flirty", "adventurous", "intellectual", "supportive"]),
       interests: z.array(z.string().trim().min(1).max(32)).min(1, "Pick at least one").max(8),
       companionGoal: z.string().trim().min(1).max(280),
     });

     // Step 3: optional first-companion pick (may be skipped)
     export const onboardingPickSchema = z.object({
       firstCharacterId: z.string().uuid().nullable().optional(),
     });

     // Composed (finish). firstCharacterId stays optional/nullable.
     export const onboardingInputSchema = onboardingIdentitySchema
       .merge(onboardingTasteSchema)
       .merge(onboardingPickSchema);

     export type OnboardingDraft = Partial<z.infer<typeof onboardingInputSchema>>;
     export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
     ```
   - Keep enums small and human-labeled in the UI; do NOT free-text gender or vibe
     (bounded values make the memory-hint seeding and future analytics clean).
   - `interests` is a bounded string array so step 2 can render a chip multiselect.
   - Export from `packages/shared/src/index.ts` (add `export * from "./onboarding";`).
     No runtime side effects, no Node imports (respect the `@buttercupp/shared`
     purity rule from `CLAUDE.md`).

2. **Prisma schema (additive): `packages/database/prisma/schema.prisma`**
   - On `model User`, add one scalar flag and one relation (both additive/nullable):
     ```
     completedOnboardingAt  DateTime?
     profile                UserProfile?
     ```
     `completedOnboardingAt` is the once-flag the `(protected)` layout reads on
     every request; it lives on User (not in JSON) so the gate check is a single
     cheap column read.
   - Add the 1:1 profile model near the User block:
     ```
     model UserProfile {
       id           String   @id @default(uuid())
       userId       String   @unique
       displayName  String?
       gender       String?
       // Free-form taste blob: { vibe, interests: string[], companionGoal }.
       // Kept as Json to avoid a column explosion while the shape stabilizes.
       preferences  Json?
       createdAt    DateTime @default(now())
       updatedAt    DateTime @updatedAt

       user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
     }
     ```
   - Everything is nullable and there is no backfill, so the migration is safe on
     existing users (they simply have `completedOnboardingAt = null` and no
     profile row, and the layout will route them through onboarding once).
   - Generate the migration CREATE-ONLY and apply to a LOCAL DB only:
     `npx prisma migrate dev --create-only --name add_user_profile_onboarding`
     then apply locally with `npx prisma migrate dev` (LOCAL DB you booted). Do
     NOT run `migrate deploy` against any hosted DB (guardrail).

3. **Step config (client-usable): `frontend/app/onboarding/steps.ts`** (new)
   - Copy the shape of `frontend/app/(protected)/create/steps.ts` exactly:
     ```ts
     import {
       onboardingIdentitySchema,
       onboardingTasteSchema,
       onboardingPickSchema,
       type OnboardingDraft,
     } from "@buttercupp/shared";
     import type { ZodTypeAny } from "zod";

     export type OnboardingStepKey = "identity" | "taste" | "pick" | "finish";

     export interface OnboardingStepConfig {
       key: OnboardingStepKey;
       label: string;
       path: string;
       schema: ZodTypeAny; // finish uses a passthrough (nothing to validate)
       optional?: boolean;  // step 3 (pick) can be skipped
     }

     export const ONBOARDING_STEPS: OnboardingStepConfig[] = [
       { key: "identity", label: "You",      path: "/onboarding/identity", schema: onboardingIdentitySchema },
       { key: "taste",    label: "Taste",    path: "/onboarding/taste",    schema: onboardingTasteSchema },
       { key: "pick",     label: "Match",    path: "/onboarding/pick",     schema: onboardingPickSchema, optional: true },
       { key: "finish",   label: "Finish",   path: "/onboarding/finish",   schema: onboardingPickSchema.partial() },
     ];
     ```
   - Reuse the `validateStep(step, draft)` helper verbatim (copy it from
     `create/steps.ts`; it `safeParse`s the slice against the partial draft and
     returns `{ ok, fieldErrors }`). Do NOT change its logic.

4. **Wizard context: `frontend/app/onboarding/context.tsx`** (new)
   - Clone `create/context.tsx` almost verbatim, retargeted to onboarding:
     - Same React-state + `localStorage` draft mirror keyed by
       `ONBOARDING_DRAFT_STORAGE_KEY`; hydrate on mount; render children only once
       hydrated (avoids the shell flickering to defaults).
     - `currentStepKey` derived from `usePathname()` against `ONBOARDING_STEPS`.
     - `goNext` / `goBack` walk `ONBOARDING_STEPS`; `goNext` is blocked unless the
       current step validates (except an `optional` step, which may advance with an
       empty slice).
     - `submit()` calls the finish Server Action (step 6) instead of a fetch, then
       clears the localStorage draft and `router.push("/dashboard")`.
   - Keep it a thin client provider (`"use client"`), exactly like the create one.

5. **Route group + pages: `frontend/app/onboarding/`** (new)
   - `layout.tsx` (server component): the ONBOARDING gate, mirroring the consent
     pattern.
     - `const user = await requireAuth();`
     - Redirect OUT if the user should not be here:
       - not age-verified (`user.ageVerifiedAt === null` or level `none`) ->
         `redirect("/age-gate")` (they must finish the gate first).
       - already onboarded (`user.completedOnboardingAt !== null`) ->
         `redirect("/dashboard")` (never re-run).
     - Wrap children in the dark shell wrapper `div.buttercupp-app` and a centered
       `buttercupp-glass` card so the wizard matches the in-app aesthetic. Render
       a `<OnboardingProvider>` (from step 4) around the step children.
     - A small step progress indicator (dots or a labeled 1/4 pill) using
       `buttercupp-accent-rose` for the active step.
   - `identity/page.tsx`, `taste/page.tsx`, `pick/page.tsx`, `finish/page.tsx`:
     each a small client step component that reads/writes the draft via the
     provider and renders the sticky footer Back/Continue (reuse
     `@/components/ui/button`). Styling: single column, large inputs, generous
     spacing, `buttercupp-glass` card, rose/violet gradient accents (copy the
     gradient style from the dashboard Create CTA and the signup wordmark). No new
     tokens.
     - `identity`: text input for displayName, a 4-way segmented control for
       gender (`woman | man | nonbinary | prefer_not`).
     - `taste`: a 5-way `vibe` picker (cards), an interests chip multiselect
       (bounded list of suggested interests plus the array from the schema), and a
       short `companionGoal` textarea.
     - `pick` (OPTIONAL): server component wrapper that fetches 6 to 8 recommended
       characters and passes them to a client picker (step 7). A visible "Skip for
       now" advances with `firstCharacterId = null`.
     - `finish`: a celebratory summary ("Welcome, {displayName}") and a single
       "Enter ButterCupp" button that calls `submit()`. This is where the finish
       Server Action fires.
   - `frontend/app/onboarding/page.tsx`: redirect to the first step
     (`redirect("/onboarding/identity")`) so `/onboarding` is never a dead route.

6. **Server Action to persist: `frontend/app/onboarding/actions.ts`** (new, `"use server"`)
   - `export async function completeOnboarding(input: unknown)`:
     1. `const userId = await getAuthUserId(); if (!userId) throw ...` (or return a
        typed error the client renders). Re-derive identity server-side; never
        trust a client-passed userId.
     2. Validate with `onboardingInputSchema.safeParse(input)` (Zod at the trust
        boundary). On failure return `{ ok: false, error, issues }`.
     3. Guard once-only: if `user.completedOnboardingAt` is already set, return
        `{ ok: true }` idempotently (double-submit safe).
     4. In a single `prisma.$transaction`, upsert the profile and set the flag:
        ```ts
        await prisma.$transaction([
          prisma.userProfile.upsert({
            where: { userId },
            create: { userId, displayName, gender,
              preferences: { vibe, interests, companionGoal } },
            update: { displayName, gender,
              preferences: { vibe, interests, companionGoal } },
          }),
          prisma.user.update({
            where: { id: userId },
            data: { completedOnboardingAt: new Date() },
          }),
        ]);
        ```
        Atomic: a profile never exists without the flag flip and vice versa.
     5. Return `{ ok: true, firstCharacterId }` so the finish page can route to
        `/chat/{firstCharacterId}` when one was picked, else `/dashboard`.
   - Keep the action lean; it is the ONLY writer of `completedOnboardingAt` and
     `UserProfile`.

7. **First-companion recommendation: `frontend/app/onboarding/pick/Recommendations.tsx`** (new client) + a server fetch
   - Server side (in `pick/page.tsx`): reuse the existing gallery/feed data path.
     Prefer `getViewer()` + `getDashboardFeed(viewer)` (`frontend/lib/feed.ts`) or
     the same public gallery query the dashboard uses, take 6 to 8 items, and pass
     `CharacterCardDTO[]` down. Respect the viewer mature flag exactly as the
     dashboard does (`viewerAllowsMature(viewer)`); do NOT surface mature cards to
     a viewer who is not permitted. Optionally bias the ordering by the draft
     `vibe`/`interests` if trivially available, but a simple curated slice is
     acceptable for v1 (note this in a comment).
   - Client side: render the cards (reuse `CharacterCard` or a lightweight
     selectable variant) in a mobile-first grid; tapping a card sets
     `firstCharacterId` in the draft and highlights it with a rose ring. A "Skip
     for now" button advances with `firstCharacterId = null`.
   - Do NOT create characters here; this only records a preferred first companion.

8. **Redirect wiring (send un-onboarded users to /onboarding): `frontend/app/(protected)/layout.tsx`**
   - This layout already calls `requireAuth()` and computes `needsConsent`. Add
     one more gate AFTER the consent computation and BEFORE rendering the shell:
     ```ts
     // Age-verified but not yet onboarded -> run the wizard once.
     if (!needsConsent && user.completedOnboardingAt === null) {
       redirect("/onboarding");
     }
     ```
     Order matters: consent (age + ToS + Privacy) first (the `ConsentGate` /
     age-gate owns that), then onboarding. The `/onboarding` route group is NOT
     under `(protected)`, so this redirect does not loop (the onboarding layout has
     its own inverse gate from step 5).
   - Update the redirect targets in `SignupForm.tsx` and the age-gate page ONLY if
     you want a snappier client redirect: they may keep pushing `/dashboard`
     because the `(protected)` layout will bounce an un-onboarded user to
     `/onboarding` on arrival. Preferred: leave both as-is and let the layout gate
     do the routing (single source of truth). Document whichever you choose.
   - `middleware.ts` stays auth-only (edge cannot read the User row). Do NOT try to
     enforce onboarding in the edge middleware. Add `/onboarding` to nothing in the
     matcher unless you also want the edge auth-cookie check on it; if you add it,
     mirror the existing protected-prefix redirect-to-login behavior. Simplest:
     rely on `requireAuth()` in the onboarding layout for auth.

9. **Optional: seed preferences as memory hints: `backend/src/memory/onboarding-seed.ts`** (new, optional)
   - If enabling, expose a small helper the finish action can fire-and-forget
     (never blocking the redirect): translate the taste blob into 1 to 3 short,
     persona-agnostic memory strings (for example
     `"User prefers a cozy, supportive vibe"`,
     `"User is interested in: hiking, sci-fi, cooking"`,
     `"What the user wants from a companion: {companionGoal}"`) and write them via
     `writeMemory` from `backend/src/memory/store.ts`.
   - Caveat: `writeMemory` is scoped by BOTH `userId` AND `characterId` (that pair
     is the isolation boundary). Onboarding has no character yet UNLESS the user
     picked a `firstCharacterId`. So only seed when a first companion was chosen,
     scoped to `(userId, firstCharacterId)`. If no pick, SKIP seeding (do not
     invent a fake character id, do not write cross-character global memories).
     Keep it fire-and-forget with a try/catch so a memory failure never breaks
     onboarding completion (same discipline as the Phase 23 extractor).
   - This step is optional; ship the wizard without it if memory seeding adds risk.

## Test instructions
```
# Typecheck + shared build (schema exports must compile)
npm run typecheck
npm run build -w packages/shared

# Vitest unit: onboarding Zod schema slices (pure, no DB)
npm run test -w packages/shared -- onboarding

# Vitest unit: completeOnboarding server action (DB-guarded)
npm run test -w frontend -- onboarding-action

# Playwright E2E: full new-user flow signup -> age-gate -> onboarding -> dashboard
npm run test:e2e -- onboarding
```
Vitest cases:
- **schema slices** (`packages/shared/src/__tests__/onboarding.test.ts`, pure):
  identity rejects empty/oversized `displayName` and an out-of-enum `gender`;
  taste requires at least one interest and caps at 8, rejects an out-of-enum
  `vibe`; the composed `onboardingInputSchema` accepts a valid full draft and
  treats `firstCharacterId` as optional/nullable (accepts a uuid, accepts null,
  accepts absent, rejects a non-uuid string).
- **completeOnboarding action** (`frontend/__tests__/onboarding-action.test.ts`,
  `describe.skipIf(!DB_UP)`): seed a user, call the action with a valid input,
  assert a `UserProfile` row exists with the expected `preferences` JSON and that
  `User.completedOnboardingAt` is now set; call the action a SECOND time and assert
  it is idempotent (no throw, flag unchanged, no duplicate profile row); call with
  an invalid input and assert `{ ok: false }` with issues and NO writes.
- **layout gate** (unit or E2E): an age-verified user with
  `completedOnboardingAt === null` hitting `/dashboard` is redirected to
  `/onboarding`; the same user with the flag set is NOT redirected.

Playwright E2E (`e2e/onboarding.spec.ts`, baseURL http://localhost:3000):
- Sign up a fresh user (unique email) via the signup form.
- Complete the age gate (dob 18+, accept ToS + Privacy).
- Assert the browser lands on `/onboarding/identity` (NOT `/dashboard`).
- Step 1: fill display name, choose a gender, Continue.
- Step 2: pick a vibe, select 2 interests, type a companion goal, Continue.
- Step 3: either pick a recommended card OR click "Skip for now".
- Step 4: click "Enter ButterCupp"; assert redirect to `/dashboard` (or
  `/chat/{id}` if a companion was picked) and that the dashboard greeting shows the
  chosen display name (not the raw email).
- Reload `/onboarding` as that same user and assert an immediate redirect to
  `/dashboard` (once-only gate holds).

MANUAL (local, step by step):
1. Boot a LOCAL Postgres and run `npx prisma migrate dev` (local only).
2. `npm run dev`; open http://localhost:3000/signup in a fresh incognito window.
3. Sign up, complete the age gate. Confirm you land on `/onboarding/identity`, not
   the dashboard.
4. Walk all 4 steps. On step 3 try both "Skip" and "pick a card" (two separate
   runs) and confirm the finish routing differs (dashboard vs chat).
5. Confirm the dashboard now greets you by display name.
6. Manually navigate back to `/onboarding`; confirm you are bounced to
   `/dashboard`.
7. Refresh mid-wizard (before finishing) and confirm the localStorage draft
   restores your inputs (reused create-wizard behavior).
8. In psql: `select "completedOnboardingAt" from "User" where email = '...';` is
   non-null, and one `UserProfile` row exists with the expected `preferences`
   JSON.
9. Resize to a narrow mobile viewport and confirm single-column layout, large tap
   targets, and a usable sticky footer nav on every step.

## Sanity checklist
- [ ] New users flow signup -> age-gate -> /onboarding -> /dashboard; the wizard
      NEVER appears before age verification.
- [ ] `/onboarding` is 3 to 4 steps, mobile-first, single column, built only from
      existing tokens (`buttercupp-glass`, `buttercupp-accent-rose`,
      `buttercupp-accent-violet`, `buttercupp-scrim`, `buttercupp-app`).
- [ ] The wizard reuses the create-wizard pattern (React state + localStorage
      draft + `validateStep` from `@buttercupp/shared`); no new state library.
- [ ] Every mutation validates with Zod at the server boundary; `completeOnboarding`
      re-derives the user from the auth cookie and never trusts a client userId.
- [ ] Schema change is additive and nullable (`User.completedOnboardingAt`,
      `UserProfile` 1:1 with `preferences Json?`); existing users are unaffected and
      the migration ran against a LOCAL DB only.
- [ ] Persistence is atomic: profile upsert + flag flip run in one
      `prisma.$transaction`; a re-submit is idempotent.
- [ ] The `(protected)` layout redirects age-verified but un-onboarded users to
      `/onboarding`, and the onboarding layout redirects already-onboarded users
      back to `/dashboard` (no loop).
- [ ] The optional first-companion step respects the viewer mature flag and never
      surfaces restricted cards; "Skip for now" works and records null.
- [ ] Dashboard greets by `displayName` when present.
- [ ] One PrismaClient (`import { prisma } from "@buttercupp/database"`); no
      `new PrismaClient()` anywhere added.
- [ ] No em dashes in any new file.

## Done criteria
- A fresh user is guided through a 3 to 4 step magical onboarding immediately after
  age verification, exactly once, and lands on `/dashboard` (or their chosen
  companion's chat).
- `UserProfile` (displayName, gender, preferences JSON) and
  `User.completedOnboardingAt` persist via an atomic, idempotent, Zod-validated
  server action, on a safe additive local migration.
- The `(protected)` layout gate + onboarding layout inverse gate route users
  correctly with no redirect loop; the once-flag prevents re-runs.
- Unit tests (schema + action), the layout gate check, and the E2E new-user flow
  are green (DB-backed tests cleanly skipped when no local DB).
- Optional memory-hint seeding, if included, is fire-and-forget, correctly scoped
  to `(userId, firstCharacterId)`, and never blocks or breaks completion.

## Guardrail note
STOP before any commit, push, non-local DB migration (this phase adds
`User.completedOnboardingAt` and a `UserProfile` model; applying that migration to
any hosted or prod database requires an explicit, fresh, per-action human
approval), secret write, or ECS / Amplify deploy. Local work (file edits, local
Postgres `prisma migrate dev`, local tests, local `npm run dev`) proceeds without
it. Prior approval never carries to the next action; ask again each time.
