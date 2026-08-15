# Phase 26: Swap the Free Display Asset

## Goal
Make the FREE, non-paywalled image the one shown everywhere as the public/display
asset, and stop overloading `CharacterMedia.isPrimary` to mean two different
things. Today `isPrimary` is doing double duty: it marks the avatar shown on
cards AND it is the "index 0 is free, index 1+ are locked" boundary the gallery
paywall keys off. In the intended two-images-per-character world the `isPrimary`
image is the hero/paywalled asset while a second image is the one meant to be
free to view, so the current read sites show the wrong (or the paywalled) image
in public surfaces. This phase introduces an explicit `isDisplay Boolean` flag
on `CharacterMedia` (additive, nullable-safe for a LOCAL migration), backfills it
so each character's free/secondary asset becomes the display image while the
other stays behind the upgrade nag, flips ALL UI read sites (PersonaPanel primary
slot, chat header avatar, chat-top image, `CharacterCard` avatar, dashboard
recents, gallery, landing) to read the display asset, updates the seed so new
personas get the flags, and confirms the paywall still hides the hero asset.
No change to retrieval, no change to the paywall UX itself, only WHICH asset each
surface reads.

Reference: PRD (character media / gallery paywall), CLAUDE.md (Prisma singleton,
strict TS, no em dashes, local-DB-only migrations).

## Prerequisites
- Phase 03 green: public gallery, `CharacterCard`, character detail, restricted CTA.
- Phase 09/07 green: `CharacterMedia` rows carry image + video assets; the gallery
  paywall (locked tiles + blurred data URIs) is in place.
- The following files exist and are the read/write sites this phase touches:
  - `packages/database/prisma/schema.prisma` (`model CharacterMedia`, ~L543-561).
  - `packages/database/prisma/seed.ts` (`upsertPersona` media rebuild, ~L251-264).
  - `packages/database/prisma/sync-personas.ts` (matches by `isPrimary` image URL).
  - `frontend/lib/characters.ts` (`primaryImageFrom`, `toCard`, `listCharacters`,
    `getCharacterDetail` include + `galleryImages` filter).
  - `frontend/lib/feed.ts` (`getDashboardFeed` recents media include + `avatarUrl`).
  - `frontend/lib/marketing.ts` (`getLandingCharacters` -> `listCharacters`).
  - `frontend/app/(protected)/chat/[characterId]/page.tsx` (chat media include,
    `carouselImages`, `avatarUrl`, `imageBlurs`).
  - `frontend/components/chat/PersonaPanel.tsx` (primary slot index 0, gallery grid).
  - `frontend/components/gallery/CharacterCard.tsx` (avatar image).
  - `frontend/app/(public)/characters/[id]/page.tsx` (detail avatar + gallery).
  - `frontend/app/api/characters/[id]/gallery/route.ts` (write path, `isPrimary`).

## Context to paste into Cursor
```
You are implementing Phase 26 of ButterCupp (character media: swap the free/visible asset).

CURRENT BEHAVIOR (investigate and confirm before you touch anything):
- CharacterMedia has `isPrimary Boolean`. Exactly one image row per character is
  isPrimary (enforced by the seed/writer, not the DB).
- Everywhere that shows "the character's picture" today reads the isPrimary image:
    * frontend/lib/characters.ts primaryImageFrom() -> toCard().avatarUrl (used by
      the gallery, the landing page via getLandingCharacters, and character detail).
    * frontend/lib/feed.ts getDashboardFeed() takes media where kind=image ordered
      isPrimary desc, take 1 -> dashboard recents avatarUrl.
    * frontend/app/(protected)/chat/[characterId]/page.tsx orders media
      isPrimary desc, sort asc; carouselImages[0] is the chat-top image AND the
      chat header avatarUrl; PersonaPanel renders images[0] in the primary slot.
    * PersonaPanel gallery grid + character-detail gallery treat index 0 (the
      isPrimary image) as FREE and index >= 1 as LOCKED (blurred data URIs).
- So today the VISIBLE/free asset == the isPrimary asset, and "locked" is derived
  purely from ordering (primary first, everything after it is paywalled).

TARGET BEHAVIOR:
- The FREE/secondary image must be the one shown in every public surface
  (chat avatar, chat-top main image, CharacterCard avatar, dashboard recents,
  gallery, landing). The other image (the current isPrimary/hero one) must stay
  behind the upgrade nag (blurred locked tile, never leaks its real URL).
- Decouple "which asset is free/displayed" from isPrimary. Introduce an explicit
  `isDisplay Boolean @default(false)` on CharacterMedia. `isDisplay = true` marks
  the free/public image; `isPrimary` is retained to mark the hero/paywalled image.
  Exactly one isDisplay image per character (writer-enforced, like isPrimary).

WHY isDisplay (a boolean) and NOT a role enum:
- Additive and nullable-safe for a LOCAL migration: a new Boolean with
  @default(false) needs no data rewrite to apply; existing rows get false, then
  the backfill sets the correct row true. A role enum would force every legacy row
  to a value and couples more surfaces to a new type.
- The paywall boundary stays a simple predicate (isDisplay vs not) that mirrors the
  existing isPrimary predicate, so read sites change one field name, not their shape.
- Keep isPrimary as-is (do not repurpose or drop it); the two flags now mean two
  distinct things: isPrimary = hero/paywalled, isDisplay = free/public.

Scope rules:
- Prisma singleton only (import { prisma } from "@buttercupp/database"). Never new PrismaClient().
- Migration is additive and applied to a LOCAL DB only. No prod migrate.
- Do NOT change the paywall UX, the blur pipeline (blurMany/blurredDataUri), or the
  fact that locked tiles never expose the real URL. Only change WHICH asset is free.
- TypeScript strict, Zod on the write path. No em dashes anywhere.
```

## Build steps

1. **Investigate + write down the current free-vs-hidden mapping.**
   Confirm in the codebase (do not assume) that every "character picture" read site
   resolves to the `isPrimary` image and that the gallery/PersonaPanel paywall keys
   off array index (0 free, 1+ locked). Note that the current seed seeds a single
   image per persona as `isPrimary: true`, so on a freshly seeded local DB there may
   be only one image; the two-image split is what production/backfill introduces.
   State explicitly, in the PR description, which asset is visible today (isPrimary)
   and which becomes visible after this phase (isDisplay).

2. **Schema change (additive): `packages/database/prisma/schema.prisma`.**
   In `model CharacterMedia` add, next to `isPrimary`:
   ```
   // Free/public image: the one shown on cards, avatars, chat-top, landing.
   // Exactly one per character is expected to be true (writer-enforced, like
   // isPrimary). Decoupled from isPrimary so the hero/paywalled asset and the
   // free/display asset can be different rows.
   isDisplay   Boolean            @default(false)
   ```
   Do NOT alter `isPrimary`, `kind`, `url`, or the existing `@@index` lines. Add an
   index to make the display lookup cheap:
   ```
   @@index([characterId, isDisplay])
   ```
   Generate the migration create-only and apply LOCALLY only:
   ```
   npx prisma migrate dev --create-only --name add_character_media_is_display -w @buttercupp/database
   # review the generated SQL (should be ALTER TABLE ADD COLUMN + CREATE INDEX, no data loss)
   npx prisma migrate dev -w @buttercupp/database   # apply to LOCAL db
   ```
   The generated SQL must be a plain `ADD COLUMN "isDisplay" BOOLEAN NOT NULL DEFAULT false`
   plus the index. If Prisma proposes anything destructive, stop and reconsider.

3. **Backfill script: `packages/database/prisma/backfill-display-media.ts`** (new).
   A runnable script (`npm run backfill:display -w @buttercupp/database` ->
   `tsx packages/database/prisma/backfill-display-media.ts`) that, per character:
   - Loads image-kind `CharacterMedia` rows ordered `sort asc, createdAt asc`.
   - Chooses the FREE/secondary asset as the display image:
     * If the character has two-plus images, the free/secondary asset is the
       NON-`isPrimary` image with the lowest `sort` (the current hero is the
       `isPrimary` one and must stay paywalled). Set that secondary row
       `isDisplay = true`; clear `isDisplay` on all its siblings.
     * If the character has exactly one image, that single image is both hero and
       display, so set `isDisplay = true` on it (nothing to hide; behavior is
       unchanged for single-image personas seeded today).
   - Guarantees exactly one `isDisplay = true` image per character (in a
     `prisma.$transaction([...])` per character: an `updateMany` to clear then an
     `update` to set, so a crash never leaves zero or two display rows).
   - Idempotent: re-running produces the same assignment. Prints a per-character
     summary and a final count of characters updated. Exit non-zero if any
     character ends with != 1 display image so the run is self-checking.
   Use the Prisma singleton; never construct a client here.

4. **Seed update: `packages/database/prisma/seed.ts`.**
   In the media rebuild (`createMany`, ~L253-264) set the flags explicitly so newly
   seeded personas get a correct display asset without needing the backfill:
   - Single-image personas (today's seed): the one image row gets
     `isPrimary: true` AND `isDisplay: true` (it is the only asset; it is both hero
     and free). Behavior unchanged for these.
   - If/when the seed grows to two images per persona, seed the SECOND (secondary)
     image with `isDisplay: true` and the hero image with `isPrimary: true,
     isDisplay: false`, so a fresh seed matches the target (free image visible,
     hero paywalled) with no backfill step. Document this in a comment even if the
     seed still only has one image today, so the intent is explicit.
   Keep the delete-then-createMany idempotent rebuild; do not change reel/video rows.
   Also update `packages/database/prisma/sync-personas.ts`: where it upserts the
   image row it should also set `isDisplay: true` on the single seeded image (same
   reasoning as the seed), and its lookup by `isPrimary` image URL stays valid.

5. **UI read site: `frontend/lib/characters.ts`.**
   - `CharacterWithCurrent.media` type: add `isDisplay: boolean` to the row shape.
   - `primaryImageFrom(media)`: rename intent to the DISPLAY image. Select the row
     with `kind === "image" && isDisplay === true` first; fall back to the old
     `find(kind === "image")` (so pre-backfill / single-image rows still resolve).
     Keep the local-path / http / signAssetUrl resolution unchanged.
   - `listCharacters` and `getCharacterDetail` includes: change the media
     `orderBy` to `[{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }]`
     so the display image sorts first (used for both avatar and the gallery split).
   - `getCharacterDetail` `galleryImages` filter: the LOCKED gallery is now
     "images that are NOT the display image" (the hero/paywalled ones). Change
     `.filter((m) => m.kind === "image" && !m.isPrimary && !m.url.startsWith("/"))`
     to filter on `!m.isDisplay` instead of `!m.isPrimary`. This keeps the hero
     image behind the paywall and out of the free slot.
   - `toCard().avatarUrl` needs no change beyond `primaryImageFrom` now returning
     the display image.

6. **UI read site: `frontend/lib/feed.ts` (dashboard recents).**
   In `getDashboardFeed` the character media include is
   `where: { kind: "image" }, orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
   take: 1`. Change the `orderBy` to lead with `{ isDisplay: "desc" }` so
   `media[0]` is the free/display image, then `avatarUrl` (signed) shows the free
   asset on dashboard recents.

7. **UI read site: `frontend/app/(protected)/chat/[characterId]/page.tsx`.**
   - The `media` include `orderBy` (currently `[{ isPrimary: "desc" }, { sort: "asc" }]`)
     becomes `[{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }]` so the
     display image is `carouselImages[0]`.
   - `avatarUrl = carouselImages[0]` (chat header) and the PersonaPanel primary slot
     (`images[0]`) now resolve to the free image automatically. No shape change.
   - `imageBlurs` still blurs `carouselImages.slice(1)` inside PersonaPanel; since the
     hero image is now at index 1+ it gets blurred/locked. Confirm the hero URL is
     only ever passed as a blurred data URI to locked tiles, never as a clear src.

8. **UI read site: `frontend/components/chat/PersonaPanel.tsx`.**
   No prop-shape change is required: it already treats `images[0]` as the free
   primary slot and `images[1..]` as locked gallery tiles keyed off `imageBlurs`.
   Because the parent now supplies the display image at index 0 and the hero image
   at index 1+, the component renders the free image large and the hero image
   locked. Confirm (do not just assume): the primary `<img>` at the top uses
   `images[0]` (free), and every tile with `i >= 1` renders `item.blur` only.
   Update the file's top-of-file comment to say index 0 is the free DISPLAY image
   and index 1+ (including the hero) are paywalled.

9. **UI read site: `frontend/components/gallery/CharacterCard.tsx`.**
   No change needed if `character.avatarUrl` is populated from `toCard` (step 5);
   the card renders `avatarUrl`, which now resolves to the display image. Verify the
   mature-gating blur (`gated && "scale-110 blur-lg"`) still applies on top of the
   free image. Do not touch the gating logic.

10. **UI read site: `frontend/app/(public)/characters/[id]/page.tsx` (detail).**
    Uses `getCharacterDetail` -> `detail.avatarUrl` (now the display image) and
    `detail.galleryImages` (now the non-display / hero images, blurred via
    `blurMany`). No component change beyond confirming the avatar is the free image
    and the locked gallery holds the hero. Confirm the mature-gate blur path
    (`filter: blur(24px)`) is unchanged.

11. **UI read site: landing page (`frontend/lib/marketing.ts` + `app/(public)/page.tsx`).**
    `getLandingCharacters` calls `listCharacters` -> `toCard`, so it inherits the
    display-image avatar from step 5 with no code change. Verify the live path (not
    the `STATIC_PERSONAS` fallback) now surfaces the free image. Do not change
    `STATIC_PERSONAS` (hard-coded `/personas/N.webp` demo data, no DB media).

12. **Write path: `frontend/app/api/characters/[id]/gallery/route.ts`.**
    This endpoint sets `isPrimary` when uploading media. Extend the Zod body with an
    optional `isDisplay` boolean and, when `isDisplay === true`, clear the previous
    display image (`updateMany({ where: { characterId, isDisplay: true }, data:
    { isDisplay: false } })`) inside the same transaction as the create, mirroring
    the existing `isPrimary` single-winner logic. Return `isDisplay` in the response
    select. Do not weaken the existing `isPrimary` handling.

13. **Paywall confirmation (no code, verify only).**
    Confirm end to end that the hero/`isPrimary` image is never emitted as a clear
    URL to any public surface after the swap: it appears only as a blurred locked
    tile in PersonaPanel and the detail gallery. The free/`isDisplay` image is the
    only clear character image on cards, avatars, chat-top, dashboard, and landing.

## Test instructions
```
# Backfill logic + query correctness (Vitest, DB-guarded)
npm run test -w packages/database -- display
npm run test -w frontend -- characters
npm run test -w frontend -- feed

# Runnable backfill (LOCAL db up)
npm run backfill:display -w @buttercupp/database

# E2E (frontend + backend running against local db)
npm run test:e2e -- image-swap
```
Vitest cases (DB-backed under `describe.skipIf(!DB_UP)`, pure ones always run):
- **backfill picks the free asset** (`packages/database/**/__tests__/backfill-display.test.ts`):
  seed a character with two image rows (one `isPrimary` hero, one secondary),
  run the backfill, assert the SECONDARY (non-isPrimary, lowest sort) row is
  `isDisplay = true` and the hero is `isDisplay = false`.
- **exactly one display asset per character**: after backfill, for every character
  assert `count(isDisplay = true where kind = image) === 1`. Run the backfill twice
  and assert the assignment is identical (idempotent) and still exactly one.
- **single-image character**: a character with one image ends with that image
  `isDisplay = true` (hero and display coincide; behavior unchanged).
- **display query returns the free asset** (`frontend` unit): `primaryImageFrom`
  and the `toCard().avatarUrl` return the `isDisplay` image, not the `isPrimary`
  hero, given a two-image row set.
- **gallery excludes the display asset**: `getCharacterDetail().galleryImages`
  contains the hero (non-display) image and does NOT contain the display image.
- **write path single-winner** (gallery route): posting media with
  `isDisplay: true` flips the previous display image to false; exactly one remains.
Playwright E2E (`e2e/image-swap.spec.ts`):
- **card / landing show the free image**: on the gallery and the landing page, a
  known two-image character's card `<img src>` equals the free/display asset URL,
  not the hero URL.
- **chat avatar + chat-top show the free image**: open the chat for that character;
  the header avatar and the PersonaPanel top image src equal the display asset.
- **hero stays paywalled**: the hero asset URL never appears as a clear `src` in the
  DOM on any of those surfaces; it appears only as a blurred locked tile (data URI),
  and clicking a locked tile opens the UpgradeModal without leaking the real URL.
MANUAL:
- Boot local Postgres, `npm run seed -w @buttercupp/database`, then (to simulate the
  two-image case) insert a second hero image row for one character and run
  `npm run backfill:display`. Load `/` (landing), `/gallery`, the dashboard, and a
  chat: confirm the SAME free image renders in avatar, chat-top, card, gallery card,
  and landing card, and that the hero image is only ever the blurred locked tile.
- Query `select "characterId", count(*) from "CharacterMedia" where "isDisplay" and
  kind = 'image' group by 1 having count(*) <> 1;` against the LOCAL db and confirm
  zero rows (exactly one display image per character).

## Sanity checklist
- [ ] Chat header avatar shows the free/`isDisplay` image (not the hero).
- [ ] Chat-top main image (PersonaPanel primary slot, `images[0]`) is the free image.
- [ ] `CharacterCard` avatar (gallery + dashboard recents) is the free image.
- [ ] Gallery card and landing card render the free image.
- [ ] The hero/`isPrimary` image stays blurred/locked and its real URL never reaches
      the DOM on any public surface.
- [ ] Exactly one `isDisplay = true` image per character (verified by query + test).
- [ ] Migration is additive (`isDisplay Boolean @default(false)` + index); the
      generated SQL is ADD COLUMN + CREATE INDEX only, applied to LOCAL db only.
- [ ] `isPrimary` is retained and unchanged in meaning (hero/paywalled marker);
      no read site still keys "free vs locked" off `isPrimary`.
- [ ] Seed + `sync-personas` set `isDisplay` so a fresh seed needs no backfill.
- [ ] Prisma singleton only; no `new PrismaClient()`; no em dashes; strict TS clean.

## Done criteria
- Every public surface (chat avatar, chat-top, card, dashboard, gallery, landing)
  reads the free/`isDisplay` image; the hero/`isPrimary` image stays behind the
  upgrade nag with its URL never leaked.
- `isDisplay` is an additive, nullable-safe column; the backfill deterministically
  sets exactly one display image per character (the free/secondary asset), is
  idempotent, and self-checks; the seed and `sync-personas` produce correct flags.
- Backfill Vitest + query tests and the Playwright swap spec are green (or cleanly
  skipped without a DB), proving the free image is shown and the hero stays paywalled.
- Zero change to the paywall UX, the blur pipeline, mature gating, or retrieval.

## Guardrail note
STOP before any commit, push, non-local DB migration (this phase adds
`CharacterMedia.isDisplay`; applying that migration or running the backfill against
any hosted/prod database requires explicit, fresh, per-action human approval),
secret writes, or ECS/Amplify deploy. Local work (edits, local Postgres migrate,
`npm run backfill:display` against the LOCAL db, local tests, local dev server)
proceeds without it. Prior approval never carries to the next action.
