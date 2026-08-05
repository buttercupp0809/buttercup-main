# Phase 06: Character-creation wizard

## Goal
Ship the 5-step character-creation wizard from PRD §5.7: (1) style, (2) identity with 18+ enforcement + avatar upload/generate, (3) appearance → AppearanceSheet template with negative prompts, (4) personality/backstory/traits/greeting + voice selection → VoiceProfile, (5) privacy/publish with `contentRating` and moderation-before-publish. Drive it with a wizard context/provider + a steps config array mirroring Pellow's `app/onboard/context.tsx` + `steps.ts` (per-step validation gating Next, localStorage draft autosave). Provide a live preview thumbnail. On finish, persist `Character` + immutable `CharacterVersion`, index the character for gallery search, and route the creator into chat. Back it with `POST /api/characters` (create), `PATCH /api/characters/:id` (creates a new `CharacterVersion`), and `POST /api/characters/:id/publish` (moderation gate then publish).

Covers PRD §5.7 (wizard) and §5.2 (character system / versioning / gallery indexing).

## Prerequisites
- Phases 00–05 green. Specifically: full schema (`Character`, `CharacterVersion`, `AppearanceSheet`, `VoiceProfile`, `Conversation`), gallery list/detail + search (Phase 03) so a published character becomes discoverable, chat route (Phase 04) so "finish → chat" works, and the `buildPromptLayers` persona layer (Phase 04) so a wizard can produce a `systemPromptSnapshot`.
- Age/identity helpers from Phase 01 (`getSession`, age-verification state). S3/media upload will be fully wired in Phases 07–09; in this phase avatar "generate" may enqueue a stub media job or accept an uploaded file (see step 3).

## Context to paste into Cursor
> Building ButterCupp Phase 06 (character-creation wizard). Read `prds/master-prd.md` §5.7 and §5.2 first. Mirror Pellow's onboarding wizard architecture:
> - `../Pellow/frontend/app/onboard/context.tsx`: a React Context provider (`OnboardingProvider` + `useOnboarding`) holding `data`, `currentStep`, `updateData(partial)`, `canContinue` (gates Next per step/micro-step), `goNext`/`goBack`, `persistProgress` (fire-and-forget save), and localStorage autosave via a `useEffect` on `data` change (with a `sanitizeForStorage` that strips sensitive fields). Render nothing until `hydrated`.
> - `../Pellow/frontend/app/onboard/steps.ts`: an exported `STEPS: StepConfig[]` array; each `StepConfig` has `key`, `label`, `path`, `requiredFields: string[]`, `microSteps`, optional `microStepRequiredFields: string[][]` for per-micro-step validation, plus `getEffectiveRequiredFields(step)` helpers.
> Adapt those patterns to a 5-step character builder (`CharacterWizardProvider` / `useCharacterWizard` + `CHARACTER_STEPS`). Prisma singleton `import { prisma } from "@buttercupp/database"`, Zod on every route, TypeScript strict, no em dashes.

## Build steps
Do these in order. Name files exactly as below.

1. **Shared DTOs + validation**: `packages/shared/src/character-create.ts`
   - Zod schemas for each step's slice and a composed `characterDraftSchema`: `style` (`realistic|3d|anime`); `identity` (name, `age` with `.min(18)` HARD, gender, avatar ref); `appearance` (traits: hair/eye/body/features/clothing, `stylePrompt`, `negativePrompt`, `referenceImageKeys[]`); `personality` (backstory, traitTags[], behavioralInstructions, greeting, `voiceProfile` selection); `publish` (`visibility` private|public, `contentRating` sfw|mature).
   - Export `createCharacterInput` (full draft) and `patchCharacterInput` (partial → new version). Re-export from `packages/shared/src/index.ts`.

2. **Wizard steps config**: `frontend/app/(app)/create/steps.ts`
   - Export `CHARACTER_STEPS: CharacterStepConfig[]` with keys `["style","identity","appearance","personality","publish"]`. Each entry: `key`, `label`, `path`, `requiredFields: (keyof CharacterDraft)[]`, and per-field validators referencing the step Zod slice. Add `getEffectiveRequiredFields(step)` and a `validateStep(step, draft)` returning `{ ok, fieldErrors }`. The identity step's validator enforces `age >= 18`.

3. **Wizard context/provider**: `frontend/app/(app)/create/context.tsx`
   - `CharacterWizardProvider` + `useCharacterWizard()`. Value shape (mirror Pellow's `OnboardingContextValue`): `draft`, `currentStep`, `currentStepConfig`, `updateDraft(partial)`, `canContinue` (from `validateStep`), `fieldErrors`, `saving`, `goNext`/`goBack`, `persistDraft()` (fire-and-forget autosave), `previewThumbUrl`. Autosave: a `useEffect` on `draft` writes to `localStorage` under a `buttercupp_character_draft` key via `sanitizeForStorage` (never persist raw uploaded file blobs). Hydrate from localStorage on mount; render children only once `hydrated`.

4. **Wizard shell + step routes**: `frontend/app/(app)/create/layout.tsx` (wraps provider + progress rail) and one page per step:
   - `create/style/page.tsx`: three style cards (Hyper-realistic / Stylized 3D / Anime); selecting sets `draft.style` and the downstream generation-pipeline params (comment the mapping to Phase 09 image params).
   - `create/identity/page.tsx`: name, age (18+ enforced inline with a clear block message), gender, and an avatar control that either uploads a file or triggers "generate" (step 6). Under-18 blocks Next.
   - `create/appearance/page.tsx`: trait fields + style prompt + optional negative prompts → assembles the AppearanceSheet template; show the composed image-prompt preview string.
   - `create/personality/page.tsx`: backstory/lore textarea, trait tags (chips) + custom behavioral instructions, greeting message, and a `VoiceProfile` picker (list preset voices from a static catalog for now; provider params filled in Phase 08).
   - `create/publish/page.tsx`: private/public toggle, `contentRating`, a summary card, and Finish.

5. **Live preview thumbnail**: `frontend/components/create/PreviewCard.tsx`
   - Renders a card matching the Phase 03 `CharacterCard` from the current `draft` (avatar or placeholder, name, tags, bio) so the creator sees the gallery card live. Update on every `updateDraft`.

6. **Avatar upload/generate**: `frontend/app/api/media/avatar/route.ts`
   - `POST`: accept an uploaded image (store to S3 or local dev bucket, return a key) OR enqueue a generate job. Full media queue lands in Phase 07 and image gen in Phase 09; here, wire the "generate" branch to a stub that returns a placeholder key with a `TODO(phase-09)` so the wizard flow is complete end-to-end without blocking on the media pipeline. Age-gate mature avatar generation.

7. **System-prompt snapshot builder**: `backend/src/characters/build-snapshot.ts`
   - `buildCharacterSystemPrompt(draft): string` composing the persona layer from wizard data (persona/behavioral instructions + backstory + greeting + style/appearance flavor), reusing the Phase 04 `persona-prompts.ts` blocks. This snapshot is stored on `CharacterVersion.systemPromptSnapshot` so a conversation pins a stable persona. Keep it deterministic (snapshot-testable).

8. **Create + version + publish endpoints**: `frontend/app/api/characters/route.ts` (extend Phase 03 file), `frontend/app/api/characters/[id]/route.ts`, `frontend/app/api/characters/[id]/publish/route.ts`
   - `POST /api/characters`: validate `createCharacterInput`; enforce `age >= 18` server-side (reject otherwise); in a transaction create `Character` (ownerUserId = caller, moderationStatus `pending` if public else `approved`, visibility, contentRating) + `AppearanceSheet` + `VoiceProfile` + the first `CharacterVersion` (versionNo 1, `systemPromptSnapshot` from step 7), set `currentVersionId`. Return the created character.
   - `PATCH /api/characters/:id`: owner-only; validate `patchCharacterInput`; create a NEW immutable `CharacterVersion` (versionNo incremented, new snapshot) and repoint `currentVersionId`. Never mutate an existing version row.
   - `POST /api/characters/:id/publish`: owner-only; run `moderateCharacter(draft)` (a `backend/src/moderation/character-moderation.ts` stub calling the safety/LLM check, real ML in Phase 11) BEFORE flipping `visibility=public` + `moderationStatus=approved`; on fail return the reason and keep it private. On success, index for gallery search (populate search fields / bump into the Phase 03 list query surface).

9. **Finish flow**: on publish/save success, clear the localStorage draft and `router.push('/chat/[characterId]')` (starts a conversation with the new character via the Phase 04 route). A private character skips moderation and goes straight to chat.

## Test instructions
- **Vitest (step validation):** `frontend/app/(app)/create/__tests__/steps.test.ts`: `validateStep` blocks Next when required fields are empty; the identity step rejects `age < 18`; a fully-filled step passes.
- **Vitest (snapshot build):** `backend/src/characters/__tests__/build-snapshot.test.ts`: `buildCharacterSystemPrompt` produces a deterministic, snapshot-matched prompt from a fixed wizard draft, and includes persona/backstory/greeting.
- **Playwright (E2E):** `frontend/e2e/create-wizard.spec.ts`: an authed user completes all 5 steps end-to-end; a public+approved character then appears in `/gallery` search results and opens in `/chat/[id]`; a private character does not appear in the gallery but still opens in chat.
- Run: `npm run test -w frontend -- create/steps`, `npm run test -w backend -- build-snapshot`, `npm run test:e2e -w frontend -- create-wizard`.

## Sanity checklist
- [ ] Under-18 is blocked in the identity step (client) AND rejected server-side on `POST /api/characters`; the block message is clear.
- [ ] A private character stays private: it never appears in gallery/search but opens in the creator's chat.
- [ ] Versioning creates an immutable `CharacterVersion`: `PATCH` adds a new versionNo and repoints `currentVersionId` without mutating prior versions; existing conversations remain pinned to their version.
- [ ] The AppearanceSheet (traits + style prompt + negative prompt) feeds the image-prompt template preview (visible in the appearance step).
- [ ] Draft autosaves to localStorage and restores on reload; sensitive/blob data is not persisted.
- [ ] Public publish runs moderation BEFORE it becomes visible; a rejected character stays private with a reason surfaced.
- [ ] Live preview card updates as the draft changes and matches the Phase 03 gallery card layout.

## Done criteria
"Green" = step-validation and snapshot Vitest suites pass; the Playwright wizard spec completes end-to-end with a public character appearing in the gallery and opening in chat and a private one staying hidden; 18+ is enforced on both client and server; versioning produces immutable `CharacterVersion` rows; and moderation gates public publish. Avatar "generate" may remain a Phase-09 stub as long as the flow completes.

## Guardrail note
Do not commit, push, deploy, or run a non-local migration in this phase. Do not write to any hosted S3 bucket or non-local secret store during avatar upload wiring; keep it local. Every commit, push, deploy, or non-local DB migration requires a fresh, explicit, per-action human approval. Stop and ask before any such action.
