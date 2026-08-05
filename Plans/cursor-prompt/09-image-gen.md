# Phase 09 - Image / selfie generation with character consistency

## Goal
Plug an **image job handler** into the Phase-07 media pipeline that generates character-consistent selfies/portraits via **Fal.ai or Replicate (SDXL / Flux)**. The core deliverable is **character consistency**: each character carries an `AppearanceSheet` (traits + style prompt + negative prompt) + reference image(s), and generation is conditioned via **LoRA or IP-Adapter** so the same character looks the same across generations. Prompt-crafting is split into `image-decision -> image-prompt -> enqueue`, mirroring Pellow `image-decision.ts` + `image-prompt.ts`. Results are stored to S3 as `MediaAsset`, rendered inline in chat, and surfaced in a per-character selfie gallery with lazy loading. Each image debits token credits (via the Phase-07 ledger).

Reference: PRD §5.6 (image/selfie generation), §11 (media pipeline, character consistency), §5.2 (AppearanceSheet), §12 (18+ enforcement).

## Prerequisites
- Phase 07 green: media queue, worker, `handlers/index.ts` registry, `MediaAsset`, S3 upload + signed URL, `media.ready` WS push, atomic token debit/refund.
- Phase 02 green: `AppearanceSheet` (traits, stylePrompt, negativePrompt, referenceImageKeys[], loraRef?) and `Character.style` (`realistic | 3d | anime`), `contentRating`, `age`.
- Phase 06 green: creation wizard produces the `AppearanceSheet` (Step 3) and initial reference image (Step 2).
- Env: `FAL_KEY` or `REPLICATE_API_TOKEN`.

## Context to paste into Cursor
```
You are implementing Phase 09 of ButterCupp (see prds/master-prd.md §5.6, §11, §5.2, §12).

Register an "image" handler into the Phase-07 pipeline (backend/src/media/handlers/index.ts). Do NOT re-implement the queue, worker, S3, or token ledger, reuse Phase 07.

CHARACTER CONSISTENCY is the whole point. Build the prompt from the character's AppearanceSheet:
- positive prompt = stylePrompt + traits (hair/eye/body/features/clothing) + scene from the user request
- negative prompt = AppearanceSheet.negativePrompt (always applied)
- conditioning = reference image(s) via IP-Adapter (zero-shot) OR a trained LoRA (AppearanceSheet.loraRef) when present
- style (realistic|3d|anime) selects the base model + pipeline params

Mirror Pellow's split:
- ../Pellow/backend/src/media/image-decision.ts -> when to send an image (isImageRequest + shouldSendImage), ButterCupp-adapted.
- ../Pellow/backend/src/media/image-prompt.ts -> buildImagePrompt/caption, but ButterCupp builds from the AppearanceSheet (NOT Pellow's SFW time/mood templates; ButterCupp is mature-gated and character-driven).
- ../Pellow/backend/src/media/image.ts -> provider fallback shape (DALL-E -> Pollinations there; Fal -> Replicate here).

18+ enforcement: subjects must be the character (age >= 18, enforced at creation) and never a minor. Apply a hard negative-prompt safety block and reject prompts that request minors. Token debit happens in the Phase-07 worker (reason: "image_gen").
No em dashes. TypeScript strict. Zod on any new route/DTO.
```

## Build steps

1. **Image constants**: `backend/src/media/image/constants.ts`
   - `IMAGE_TOKEN_COST` (add to the Phase-07 `MEDIA_TOKEN_COSTS` map in `packages/shared`).
   - Per-style model map: `{ realistic: <flux/sdxl-realistic model id>, "3d": <...>, anime: <...> }` for Fal and for Replicate.
   - `SAFETY_NEGATIVE`, a mandatory negative-prompt block appended to every request (child, minor, underage, etc.). This is the hard 18+ guard (PRD §12).
   - `IMAGE_SIZE` defaults per style.

2. **AppearanceSheet -> prompt**: `backend/src/media/image/prompt.ts` (mirrors Pellow `image-prompt.ts`)
   - `buildImagePrompt({ appearanceSheet, style, userRequest })`:
     - positive = `stylePrompt` + serialized traits (hair, eye, body, features, clothing) + the scene/pose derived from `userRequest` (e.g. "selfie in a cafe").
     - negative = `appearanceSheet.negativePrompt` + `SAFETY_NEGATIVE`.
   - `buildImageCaption(userRequest)` -> short in-character caption (parallel to Pellow's `buildImageCaption`).
   - Deterministic serialization of traits so the SAME sheet yields the SAME core prompt across generations (consistency), only the scene varies.

3. **Image-decision**: `backend/src/media/image/decision.ts` (mirrors Pellow `image-decision.ts`)
   - Port `isImageRequest(text)` (the regex set: send/show/give a pic/selfie/photo, etc.).
   - `shouldSendImage(userId, characterId, { userRequested })`: ButterCupp-adapted gating, check tier/token balance (image is a paid consumable, PRD §13) and per-(user,character) recent-image count. Keep the `userRequested` fast path.

4. **Providers**: `backend/src/media/image/providers.ts` (mirrors `image.ts` fallback shape)
   - `generateWithFal({ prompt, negativePrompt, style, referenceImages, loraRef })`: call Fal.ai SDXL/Flux; pass IP-Adapter reference image(s) or LoRA weights. Return a Buffer.
   - `generateWithReplicate(...)`: same contract against Replicate as fallback.
   - `generateImage(params)`: try Fal (if `FAL_KEY`) -> Replicate (if `REPLICATE_API_TOKEN`); per-provider try/catch + session disable flags; 401/403 disables the provider for the session (Pellow pattern). Throw when exhausted (worker marks `failed` + refunds).

5. **Consistency conditioning**: `backend/src/media/image/conditioning.ts`
   - `resolveConditioning(appearanceSheet)`:
     - if `loraRef` present -> LoRA path (attach weights + trigger word).
     - else -> IP-Adapter path using `referenceImageKeys[]` (fetch signed URLs from S3, pass as image prompts).
   - Document that reference images come from the wizard-generated avatar (Phase 06) and prior accepted selfies, so consistency compounds.

6. **Register the handler**: `backend/src/media/handlers/image.ts` + wire into `handlers/index.ts`
   - `imageHandler(job)`: load `Character` + pinned `CharacterVersion.appearanceSheet`; `buildImagePrompt`; `resolveConditioning`; `generateImage`; return `{ buffer, contentType: "image/png", meta: { provider, prompt, seed } }`. Phase-07 worker uploads to S3 + emits `media.ready`.
   - Replace the Phase-07 `mockHandler` for `kind: "image"` with `imageHandler`.

7. **Chat + enqueue integration**
   - In the Phase-04 chat turn: run `isImageRequest` / `shouldSendImage`; if true, `enqueueMediaJob` with `kind: "image"`, `payload.userRequest`, `characterVersionId`, `tokenCost = IMAGE_TOKEN_COST`. Text reply streams immediately; the image arrives via `media.ready`. Chat never blocks.
   - Explicit `POST /api/media/image` route (added in Phase 07) for a "send a selfie" button.

8. **18+ enforcement**: `backend/src/media/image/safety.ts`
   - Assert `Character.age >= 18` before enqueue (belt-and-suspenders; creation already enforces it).
   - Scan `userRequest` for minor-referencing terms; reject with a safe error (no enqueue, no token debit). Always append `SAFETY_NEGATIVE`. Log rejects via `audit.ts` (feeds Phase-11 safety).

9. **Frontend: inline render**: `frontend/components/chat/ImageMessage.tsx`
   - On `media.ready` with `kind: "image"`, render the image bubble from the signed URL, with a `queued/processing` skeleton first, error state on `error`. Tap to open full-size.

10. **Frontend: selfie gallery**: `frontend/app/characters/[id]/gallery/page.tsx` + `SelfieGallery.tsx`
    - Per-character grid of all `ready` image `MediaAsset`s for `(user, character)`. **Lazy-load** via `IntersectionObserver` / `loading="lazy"` + paginated fetch. Reuse design tokens + card components (Pellow pattern).
    - `GET /api/characters/:id/gallery` returns paginated ready assets with fresh signed URLs.

11. **Metrics**: image-provider outcome counters (which provider, latency, consistency-mode lora|ipadapter) mirroring Pellow `metrics.ts`.

## Test instructions
```
# Vitest (backend)
npm run test -w backend -- image

# With a real provider key (optional live run):
FAL_KEY=... npm run test -w backend -- image.live

# Frontend (Playwright / manual)
npm run dev
# In chat with a character: "send me a selfie" -> image bubble appears; open the gallery
```
Vitest cases (`backend/src/media/image/__tests__/`):
- **prompt build**: `buildImagePrompt` from an `AppearanceSheet` includes stylePrompt + traits + the user scene AND the negative prompt (sheet negative + `SAFETY_NEGATIVE`). Same sheet -> same core prompt across calls (consistency).
- **decision logic**: `isImageRequest` matches request patterns; `shouldSendImage` respects token/tier gating + `userRequested` fast path.
- **provider fallback**: Fal absent/erroring -> Replicate; 401 disables provider for the session.
- **token debit**: image job debits `IMAGE_TOKEN_COST`; failure refunds.
- **18+ enforcement**: a minor-referencing `userRequest` is rejected before enqueue (no token debit); `Character.age < 18` cannot enqueue.

Manual: request a selfie; generate 3-4 times; confirm the character's hair/eyes/features stay consistent with the `AppearanceSheet` across generations; gallery lazy-loads on scroll.

## Sanity checklist
- [ ] Consistency holds: repeated generations of the same character match the `AppearanceSheet` (same core traits), only scene/pose vary.
- [ ] 18+ enforced on subjects: `Character.age >= 18` required, minor-referencing prompts rejected, `SAFETY_NEGATIVE` always applied.
- [ ] Image job runs async on the Phase-07 queue; the text reply streams without waiting (chat not blocked).
- [ ] Image rendered inline in chat on `media.ready`; gallery shows all ready selfies and lazy-loads.
- [ ] Token debited once per image (`reason: "image_gen"`); failed generation refunds.
- [ ] Fal -> Replicate fallback works when the primary key is missing/erroring.

## Done criteria
- `imageHandler` registered in the Phase-07 registry; mock handler for image removed.
- Character consistency demonstrable across multiple generations from one `AppearanceSheet` (+ IP-Adapter/LoRA conditioning).
- Chat can deliver a selfie without blocking the text stream; per-character gallery lazy-loads.
- 18+ safety enforced server-side, logged to audit.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret writes (Fal/Replicate keys into SSM/Secrets Manager), or ECS deploy. Each requires an explicit, fresh, per-action human approval. Local-only work (edits, local tests, local dev server, local worker) proceeds without it. Prior approval never carries to the next action.
