# 35 - Major Fixes Batch (chat, tiers, pixel, performance, image-gen, personas, main-image)

> Source of truth for a batch of 9 production issues. Read `CLAUDE.md`
> (repo root) first: Prisma singleton rule, no em dashes anywhere, zod at
> trust boundaries, ask-before-prod guardrails. This file never contradicts
> `CLAUDE.md`.

## How to use this document

Each section is self-contained: **Symptom -> Root cause (with exact
file:line) -> Change -> Edge cases -> Sanity checks -> Regression guards**.
Implement in the build order below. Every code path here has been traced;
the file:line anchors were correct at planning time (2026-08-20). If a line
number has drifted, match on the quoted symbol, not the number.

### Locked product decisions (do not re-litigate)

1. **Tiers**: display-only rename. Every PAID tier (`premium` AND `pro`)
   renders the label **"Premium"** in the UI. The Prisma enum, plan mapping,
   webhooks, and feature gating (`premiumModel = tier === "pro"`) are left
   UNCHANGED. No migration. No billing logic touched.
2. **Personas**: restore exactly the personas in `Plans/persona-list.md`
   (144 entries), one Character row each. The few legitimately repeated
   first-names stay (their bio/location differ). Add a stable natural key +
   unique constraint so re-seeding can never duplicate again.
3. **Main image**: new bulk run produces exactly **1 image per character**.
   That image becomes the single MAIN/lead (new `isMain` flag). ALL prior
   images are demoted to secondary. The dynamic display re-election is
   removed so chat-generated images can never steal the lead again.
4. **Deliverable**: this single sectioned document.

### Build order (dependencies matter)

```
A. #7  Persona dedupe + restore + unique constraint   (data foundation)
B. #9  Main-image flag + stop display re-election      (schema + read sites)
C. #8  Specialized bulk-from-file (1 image/character)  (depends on A + B)
D. #6  Image-gen intent + pill context + prior context (backend chat)
E. #1  Chat image render hardening + error boundary    (frontend chat)
F. #2  Chat input auto-focus                           (frontend chat)
G. #3  Tier label -> "Premium" + hide upsell pill       (frontend)
H. #4  Meta Pixel CSP fix (Lead event)                  (frontend config)
I. #5  Performance: image + chat waterfall + lazy load  (frontend, broad)
```

A -> B -> C is a hard chain (C writes the flag B defines onto the rows A
restores). D through I are independent and can be parallelized across
engineers once A/B are merged.

### Global guardrails (apply to EVERY section)

- **No em dashes** anywhere (code, comments, commits, docs). `npm run
  check:no-em-dash` must pass. Use commas, periods, parentheses.
- **Prisma singleton**: import `{ prisma } from "@buttercupp/database"`.
  Never `new PrismaClient()` outside `packages/database/src/client.ts`.
- **zod** validates every new mutation payload at the trust boundary.
- **Prod is gated**: any migration, data backfill, bulk run, or env change
  against a non-local environment STOPS and asks for explicit per-action
  approval. This document marks every such step with `[PROD-GATE]`. Do not
  batch them. Do not assume prior approval carries forward.
- **No regressions**: run `npm run typecheck`, `npm run build`, and the
  existing test suites in each touched workspace before declaring a section
  done. Add tests where noted.

---

## A. Issue #7 - Duplicate characters (same name + same bio)

### Symptom
Searching a name on Discover returns 7-8 rows with identical name AND
identical description.

### Root cause (traced)
- `packages/database/prisma/schema.prisma:219-248` - `Character` has **no
  unique constraint** on any natural key (only indexes on
  `visibility/moderationStatus`, `contentRating`, `popularityScore`,
  `ownerUserId`).
- Two seeders disagree on identity:
  - `packages/database/prisma/seed.ts` identifies existing personas by
    `(ownerUserId=null, name)` and cycles names with numeric suffixes
    ("Emma", "Emma 2", ...).
  - `packages/database/prisma/sync-personas.ts:71-85` matches by the primary
    image URL `/personas/N.webp` and RENAMES the row to the canonical
    persona-list name.
  - Result documented in `dedupe-characters.ts:3-13`: after a sync renames
    "Emma 5" -> "Ariana", the next `npm run seed` can no longer find
    "Emma 5", so it creates a SECOND Character for the same seed image.
    Every re-seed widened the duplicate fleet.
- Search: `packages/database/src/queries/characters.ts:43-50` does
  case-insensitive `contains` on `name` and `bio`, so every duplicate row
  surfaces.
- An idempotent cleanup already exists: `dedupe-characters.ts` (winner rule:
  most user-attached data, then earliest `createdAt`, then lowest id) but it
  **refuses any non-localhost DATABASE_URL**.

### Change
1. **Add a stable natural key + unique constraint.** The seed image URL
   (`/personas/N.webp`) is the true identity of a system persona. Introduce
   an explicit column rather than relying on a joined media row:
   - Add to `Character` model: `seedKey String? @unique` (nullable so
     user-created characters, which have no seed key, are unaffected;
     Postgres treats multiple NULLs as distinct, so the unique constraint
     only binds seeded personas).
   - Backfill `seedKey` = the persona number (e.g. `"persona-1"`) derived
     from the primary `/personas/N.webp` media URL for existing system rows.
   - Migration name: `add_character_seed_key`. Additive only (new nullable
     column + partial unique). Safe with the additive-drift guard used by
     `17-ship-all.sh`.
2. **Make `sync-personas.ts` the single source of truth** and key on
   `seedKey`, upserting by it. Update its match logic (currently
   `sync-personas.ts:71-85`) to `prisma.character.upsert({ where: { seedKey
   }, ... })`. This removes the seed.ts/sync disagreement permanently.
3. **Neuter the divergent identity path in `seed.ts`.** Either (a) make
   `seed.ts` also key on `seedKey` and stop the numeric-suffix name cycling
   for personas, or (b) demote `seed.ts` to non-persona bootstrap only and
   document that `sync-personas.ts` owns personas. Prefer (a): compute
   `seedKey` from the image index and upsert on it, so the two scripts
   converge on the same key and can both run safely any number of times.
4. **Run the existing dedupe locally, then restore.**
   - Local: `npm run dedupe:characters -w @buttercupp/database` then
     `npx tsx packages/database/prisma/sync-personas.ts`. Verify 144 system
     rows, no seedKey collisions.
   - `[PROD-GATE]` Prod restore requires a prod-safe runner. Do NOT loosen
     the localhost guard blindly. Instead add an explicit
     `--i-understand-this-is-prod` flag to `dedupe-characters.ts` that (a)
     forces a `pg_dump` of `Character`, `CharacterVersion`, `CharacterMedia`
     to a timestamped file first, (b) prints the exact winner/loser row
     counts and waits for interactive confirmation, (c) runs inside one
     transaction. Present the dump + dry-run diff to the human and get
     explicit approval before executing against prod. The dedupe winner rule
     already preserves the row with the most user-attached conversations, so
     no user history is orphaned; the losers' `Conversation`/memory rows must
     be RE-POINTED to the winner (verify dedupe-characters.ts already does
     this re-pointing before deleting losers; if it hard-deletes, add
     re-pointing).

### Edge cases
- A repeated first-name (two "Ariana"s with different bios) is CORRECT and
  must survive. Uniqueness is on `seedKey`, never on `name`.
- User-created characters have `ownerUserId != null` and `seedKey = null`.
  They must never be touched by dedupe or sync. Every query in these scripts
  MUST filter `ownerUserId: null`.
- Some `/personas/N.webp` files have gaps (not all 1..144 exist). Sync must
  skip missing image files gracefully, not create bio-only rows that render
  a broken image.
- Duplicates that already accumulated user conversations across MORE THAN
  ONE row: re-point ALL losers' conversations/memories/relationship-state to
  the winner before deleting. Losing a user's chat history is a hard failure.
- Do not truncate + reinsert on prod (that nukes user-linked FKs). Upsert +
  dedupe only.

### Sanity checks (must pass before section done)
- Local psql:
  `SELECT COUNT(*) FROM "Character" WHERE "ownerUserId" IS NULL;` -> 144.
- `SELECT "seedKey", COUNT(*) FROM "Character" WHERE "seedKey" IS NOT NULL
  GROUP BY "seedKey" HAVING COUNT(*) > 1;` -> 0 rows.
- Discover search for a known persona name returns exactly the expected
  number of rows (1 for a unique name; N for a legitimately repeated name,
  each with a DIFFERENT bio).
- `npm run typecheck` in `packages/database` and `frontend`.
- Re-run seed + sync twice back to back; row count stays 144 (idempotence
  regression test).

### Regression guards
- Add a test in `packages/database` that runs sync twice and asserts the
  system-character count is stable and no seedKey collisions exist.
- Confirm the migration is additive (nullable column) so it passes the
  `17-ship-all.sh` additive-drift guard.

---

## B. Issue #9 / #9.1 - Main image + remove dynamic lead re-election

### Symptom
The character's displayed lead image silently changes over time. User wants
a fixed weekly-curated main image; no dynamic rolling.

### Root cause (traced)
- There is **no random or time-based rotation** in the code. The "rolling"
  is caused by re-election: `backend/src/media/asset.ts:118-134`
  (`attachCreationCharacterMedia`) creates every chat-generated image with
  `isDisplay:false, isPrimary:false` and then calls
  `backfillCharacterDisplay(characterId)`.
- `packages/database/src/queries/backfill-display.ts:21-71`
  (`pickDisplayMediaId` + `backfillCharacterDisplay`) clears the current
  `isDisplay` and re-picks "first non-primary by sort". As new images arrive
  with low `sort` values, the winner can change -> the lead image "rotates".
- Every read site orders by `[{ isDisplay: "desc" }, { isPrimary: "desc" },
  { sort: "asc" }]`:
  - `frontend/lib/characters.ts:101,133` (discover + gallery + detail)
  - `frontend/app/(protected)/chat/[characterId]/page.tsx:38`
  - `frontend/lib/feed.ts:75-77` (dashboard)
  - `frontend/app/(protected)/reels/page.tsx:36`
  - `frontend/lib/chats.ts:48`

### Change
1. **Add `isMain` to `CharacterMedia`** in
   `packages/database/prisma/schema.prisma:613-644`:
   `isMain Boolean @default(false)`. Add index
   `@@index([characterId, isMain])`. Migration `add_character_media_is_main`
   (additive).
2. **New display precedence: `isMain` wins, always.** Update EVERY read site
   above to order by
   `[{ isMain: "desc" }, { isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }]`.
   Centralize this ordering in ONE exported constant
   (`packages/database/src/queries/media-order.ts`) and import it at all six
   read sites so they can never drift again. This is a targeted improvement
   worth doing while we are here (the ordering is currently copy-pasted).
3. **Stop the re-election from moving the lead.** In
   `backfill-display.ts:pickDisplayMediaId`: if any image has
   `isMain: true`, that image is the display winner and the function returns
   it without considering `sort`. Never clear a main image's status. When no
   main exists yet, keep current behavior (per locked decision option, main
   pins when present; auto-pick is the fallback only for characters with no
   main).
4. **Chat-generated images stay secondary.** `attachCreationCharacterMedia`
   already sets `isMain` implicitly false (new default). It may still call
   `backfillCharacterDisplay`, but step 3 guarantees the call is a no-op when
   a main image exists. Add an early return in
   `backfillCharacterDisplay` when a main image is present, to avoid
   needless writes on every chat image.

### Edge cases
- Exactly one `isMain: true` per character must be enforced by the writer
  (the bulk importer in section C), mirroring how `isDisplay` singularity is
  enforced today (not by DB). Add an assertion/backfill that clears any
  extra `isMain` before setting the new one, inside a transaction.
- A character with zero images: all read sites must still not crash (they
  already fall back; keep it).
- Videos (`kind: "video"`) must never be eligible for `isMain` (image lead
  only). Filter `kind: "image"` when setting main.
- The public `/gallery` and in-app surfaces share flags (no per-page logic);
  confirm the new ordering constant is used identically so a main image
  shows everywhere at once (matches the known image-swap/media-flag
  symmetry).

### Sanity checks
- After section C runs locally, every system character has exactly one
  `isMain: true` image and it renders on discover, gallery, chat, dashboard,
  reels identically.
- Generate a chat image locally for a character that has a main image;
  confirm the lead image does NOT change (the new image is secondary).
- `SELECT "characterId", COUNT(*) FROM "CharacterMedia" WHERE "isMain" AND
  kind='image' GROUP BY "characterId" HAVING COUNT(*) > 1;` -> 0 rows.

### Regression guards
- Unit test `pickDisplayMediaId`: given a set including one `isMain`, it
  returns the main regardless of `sort`/`isPrimary`.
- Grep test / lint note: the raw ordering array must not reappear inline;
  all six sites import the shared constant.

---

## C. Issue #8 - Specialized bulk generation (1 image per character from file)

### Symptom
Need a one-off, repeatable way to generate exactly one fresh image per
character for all 144 personas, marked as the main image, WITHOUT disturbing
existing bulk scripts.

### Root cause / current state (traced)
- Two existing Python bulk scripts live in `Plans/inference-aws/`:
  - `bulk_generate_v2.py` (two-stage Stheno pipeline, 5 images/persona,
    `NUM_IMAGES = 5` at line 115, dual-writes local + prod CharacterMedia,
    `isPrimary` on first only).
  - `bulk_generate_llm.py` (single-stage, 5 images/persona).
- Both read `Plans/persona-list.md` and reference images from
  `frontend/public/personas/{idx}.*`, upload to S3
  (`POPPY_S3_BUCKET_GENERATED`), and write `CharacterMedia` rows.
- Import path into DB also exists: `import-generated-variants.ts` (sets
  `sort`, `title`, `isPrimary:false`, `isDisplay:false`).

### Change
1. **New script, do not edit the existing two.** Create
   `Plans/inference-aws/bulk_generate_main.py`. Copy the plumbing (persona
   parsing, reference image resolution, ComfyUI/Juggernaut call, S3 upload,
   dual-DB write) from `bulk_generate_v2.py` but:
   - `NUM_IMAGES = 1` (exactly one image per character).
   - Reads a dedicated input file (locked decision: "from file"): default
     `Plans/inference-aws/main-image-list.txt` listing persona indices or
     seedKeys to (re)generate; support `--ids 1,2,5` and `--all`. Keep it
     separate from `persona-list.md` so the curator can control the weekly
     batch without touching the canonical persona text.
   - Uses a deterministic S3 key namespace distinct from variants, e.g.
     `character-media/{characterId}/main-{seedKey}-{yyyymmdd}.png`, so weekly
     re-runs are traceable and never collide with secondary images.
   - Writes the new row with `isMain: true` and, in the SAME transaction,
     clears any prior `isMain` for that character and demotes all other rows
     to secondary (`isMain:false`; leave their `isDisplay`/`isPrimary` as
     historical, since read ordering now puts `isMain` first). Then set
     `isDisplay:true` on the main row too (so any read site that only knows
     `isDisplay` still shows it) and clear `isDisplay` elsewhere.
   - Prints a per-character summary (character id, seedKey, S3 key, old main
     -> new main) and a final tally.
2. **A shared writer helper.** Put the "set this row as the one main image"
   transaction in a small reusable function so both the Python dual-write and
   any TS importer use the same invariant. If the canonical writer must be
   TS (to reuse Prisma), have the Python script write rows as today and then
   invoke a new
   `packages/database/prisma/promote-main-images.ts` that reads a manifest
   (character id + S3 key) and performs the atomic promote/demote. Prefer
   this TS promoter for the DB-mutating half; keep Python for
   generation+upload only. This keeps the "exactly one main" invariant in TS
   next to the schema.
3. **Idempotence + safety.** Re-running for the same character replaces its
   main image (old one demoted to secondary, not deleted). A `--dry-run`
   prints the plan without calling the GPU or writing rows.
4. `[PROD-GATE]` Running against prod S3 + prod DB, and waking the GPU box,
   are all prod-touching. Present the dry-run manifest and get explicit
   approval per run. Do not auto-run. The GPU box may be down (see project
   memory): the script must fail loudly with a clear message if the box or
   S3 bucket is unreachable, never silently write partial state.

### Edge cases
- Character with no reference image file: skip with a logged warning; do not
  create a broken main.
- Partial batch failure (GPU dies at persona 90/144): the script must be
  resumable via `--ids` and must have committed each character
  transactionally so completed ones keep a valid single main.
- Personas restored in section A that were missing before now exist; ensure
  the input file can target by `seedKey` (stable) not just array index.
- Never touch user-created characters (`ownerUserId != null`).

### Sanity checks
- Local dry-run prints exactly 144 planned characters (or the `--ids`
  subset), one image each.
- After a real local run of a small `--ids` subset: each targeted character
  has exactly one `isMain` image; it renders as the lead on all surfaces;
  previously-leading images are now secondary and still visible in the
  gallery/carousel.
- Existing `bulk_generate_v2.py` / `bulk_generate_llm.py` are byte-identical
  to before (git diff shows only the NEW file + the TS promoter + schema).

### Regression guards
- The promoter enforces single-main atomically; test with a character that
  starts with 5 images and assert exactly one `isMain` after promote.

---

## D. Issue #6 - In-chat image generation (intent, pill context, prior context)

### D.1 (#6.1) Intent detection is unreliable, hard wall on failure

**Root cause (traced)**
- `backend/src/chat/intent.ts:55-84` (`classifyMessageIntent`) is
  **LLM-only**. The old regex keyword detector was deleted
  (`intent.ts:12-13`, `decision.ts:2-6`). On timeout (1500ms,
  `intent.ts:22`), parse failure, or the provider returning the hardcoded
  fallback (GPU box down), it silently returns `"text"`
  (`intent.ts:76-80`).
- The gate is binary: `ws/gateway.ts:215` and `http/chat-stream.ts:114`
  only enter the image flow when the classifier returns `"image"`. A false
  "text" means the image request is dropped into normal chat -> the hard
  wall.

**Change**
1. **Reintroduce a fast deterministic keyword pre-check as a FLOOR, not a
   replacement.** Before (or in parallel with) the LLM call, run a small
   high-precision matcher for explicit requests ("send/show me a
   photo/pic/picture/image/selfie/nude/video", imperative forms). If the
   keyword matcher is confident, classify `"image"` immediately and SKIP the
   LLM (saves latency and removes the box-down failure mode for the obvious
   cases). Keep it high-precision to avoid false positives ("that painting is
   a pretty picture" must stay text); reuse the conservative guidance already
   in the LLM system prompt (`intent.ts:24-32`).
2. **LLM becomes the tie-breaker for ambiguous phrasing only**, with the
   keyword result as fallback when the LLM times out or the box is down.
   Never let a classifier failure silently swallow an explicit request.
3. **Explicit pill intent (ties into D.2).** When the user triggers image
   generation via a pill, the frontend sends an explicit
   `intent: "image"` signal so NO classification is needed at all. See D.2.

**Edge cases**
- Non-English or emoji-only requests: keyword matcher will miss; the LLM
  path still runs, so behavior is no worse than today.
- Avoid regressing the "conservative" contract: general mentions of pictures
  must not trigger generation. Unit-test both directions.
- Content-rating gating and paywall checks that currently run after the
  intent gate must still run; do not bypass them by short-circuiting intent.

### D.2 (#6.2) Pill pre-fill context is distorted / keywords dropped

**Root cause (traced)**
- Pills just `setInput` a fixed string:
  `frontend/components/chat/ChatWindow.tsx:554` ("Send me a photo of you
  right now"), `:560` (video). When the user appends context, pill text +
  user text are blended into one string with no origin marker.
- `backend/src/chat/image-turn.ts:76-85` (`cleanImagePrompt`) strips request
  phrasing with a fixed regex; it can strip user-meaningful words ("right
  now") and is not aware of which fragment came from the pill vs the user.
- Enrichment runs at **temperature 0.7** (`image-turn.ts:226-227`), so
  Stheno can paraphrase and drop concrete tokens even though the system
  prompt (`media/image/enrichment-fills.ts:27-39`) says PRIMARY is
  authoritative.

**Change**
1. **Carry an explicit, structured intent from the pill.** Change the pill
   handlers so a pill click sets a structured composer state, not just raw
   text: `{ intent: "image", template: "photo", userAddon: "" }`. As the
   user types after the pill, capture ONLY their addition as `userAddon`
   (keep the template separate). Send both to the backend along with
   `intent: "image"`.
2. **Preserve the user's words verbatim.** Backend builds the PRIMARY block
   as: template phrase (optional, low priority) + `userAddon` marked as the
   authoritative, must-survive fragment. Do NOT run `cleanImagePrompt`'s
   aggressive stripping over the `userAddon`; only strip the known template
   lead-in. The user's concrete tokens (outfit, place, pose, colors) must
   pass through untouched.
3. **Lower enrichment temperature** for prompt-building from 0.7 to a low
   value (0.1-0.2) so Stheno elaborates without paraphrasing away tokens.
   Strengthen the user-message template
   (`image-turn.ts:203-213`) to echo the user's exact fragment inside quotes
   and instruct "these quoted tokens must appear verbatim in the output".
4. **Post-enrichment guard.** After Stheno returns, verify every high-signal
   token from `userAddon` (nouns/adjectives above a stoplist) is present in
   the enriched prompt; if any are missing, append them verbatim rather than
   trusting the rewrite. This is the safety net that makes 6.2 robust
   regardless of model behavior.

**Edge cases**
- User clicks pill then deletes everything and types a totally different
  request: `userAddon` becomes the whole thing; template is dropped. Handle
  empty template gracefully.
- User types a request with NO pill: unchanged path, but still benefits from
  the lowered temperature and the token-preservation guard.
- Contradictions between template and userAddon: userAddon wins (matches the
  existing "PRIMARY wins" contract in enrichment-fills.ts).

### D.3 (#6.3) Prior conversation context not fed into the image prompt

**Root cause (traced)**
- Context IS wired when a `conversationId` is present:
  `image-turn.ts:274-281` -> `buildImageContext` (`:140-186`) pulls the last
  ~15 turns (clamped 10-20, `:30-31`), a running summary
  (`getLatestSummary`, `:163-165`), truncated to 1500 chars (`:36`), and
  passes it to `enrichImagePrompt` (`:194-239`) as a SECONDARY block.
- Both entry points pass `conversationId`
  (`ws/gateway.ts:257`, `http/chat-stream.ts:137`), so in the normal flow
  context is present. The real gaps:
  1. If the classifier wrongly returns "text" (D.1), the image flow never
     runs, so context is moot -> user perceives "context ignored". Fixing
     D.1 largely fixes the perceived 6.3.
  2. Enrichment calls Stheno DIRECTLY (`image-turn.ts:216-230`) with **no
     provider fallback**; when the box is down, enrichment is skipped and the
     raw cleaned prompt (no context) goes to the image model
     (`:232,235,237`).
  3. Summary/last-N retrieval failing silently yields empty context blocks
     (`:201-202`).

**Change**
1. **Route enrichment through the LLM provider chain** instead of the direct
   Stheno fetch, so OpenRouter/anthropic can enrich when the GPU box is down
   (mirror `generateImageTeaser`'s use of `callLLM` with the mature provider
   chain, `llm/provider.ts:298`). This makes context survive box outages.
2. **Make context failures loud in logs** (warn when summary or recent-turns
   come back empty) so silent context loss is observable.
3. **Confirm the summarized last 10-20 messages are always included** for
   photo/pic/picture/image requests: keep `buildImageContext`'s clamp, and
   ensure the pill/explicit-intent path (D.2) ALSO calls it (pass the same
   `conversationId`).

**Edge cases**
- Very short conversations (< 10 turns): use what exists, do not pad.
- Data-URL images already sanitized to `[shared a photo]` in context
  (`buildImageContext`); keep that so base64 never bloats the prompt.
- Character-consistency reference face is separate (InstantID path); context
  changes must not alter identity handling
  (`enrichment-fills.ts` RULE 4).

**Sanity checks (all of #6)**
- "send me a photo" with the GPU box simulated DOWN still enters the image
  flow (keyword floor) and still enriches (provider fallback).
- Pill photo + " wearing a red dress at the beach" produces an enriched
  prompt that literally contains "red dress" and "beach".
- A photo request after a 20-message roleplay includes location/wardrobe
  continuity from the summary.
- Unit tests: intent matcher precision (positive + negative sets);
  token-preservation guard; enrichment fallback when primary provider throws.

**Regression guards**
- Do not remove the conservative LLM classifier; the keyword matcher is a
  floor added beside it.
- Keep paywall + content-rating gates intact after the intent decision.

---

## E. Issue #1 - Chat breaks when an image is sent then an image reply arrives

### Symptom
`/chat/<id>` links "break" (blank/errored/garbled) specifically after an
image is attached in the input box and the assistant returns an image.

### Root cause (traced)
- `frontend/app/(protected)/chat/[characterId]/page.tsx:73-85`: the
  `imageUrl` derivation calls `m.content.startsWith("data:")` with no null
  guard; if `content` is ever null/empty this throws during server render and
  the whole page 500s.
- `frontend/components/chat/ChatWindow.tsx:433-441`: messages with no
  `imageUrl` fall through to `MessageBubble` rendering raw `m.content`. A
  user-uploaded image is stored as a base64 `data:` URL in `content`; when
  its `imageUrl` is undefined it renders the entire base64 blob as text
  (garbled, giant, can hang layout).
- `frontend/components/chat/ImageMessage.tsx:59`: `<img src={url}>` has no
  `onError`; a 404/expired-signed-URL shows a broken image with no recovery.
- There is **no `error.tsx`** in the chat route, so any render throw takes
  down the page instead of a scoped fallback.

### Change
1. **Guard the server derivation.** In `page.tsx:73-85`, coerce
   `content ?? ""` before `.startsWith`, and only treat it as an inline image
   when it actually starts with `data:image/`. Never let this throw.
2. **Classify message rendering by an explicit type, not by presence of a
   derived URL.** Prefer sending a discriminated field (e.g.
   `type: "image" | "text"`) from the loader so `ChatWindow` never renders a
   base64 blob as text. Minimum viable: in `ChatWindow.tsx:433-441`, if
   `content` looks like a `data:` URL but `imageUrl` is missing, render an
   image placeholder / retry, never the raw string.
3. **Add `onError` to `ImageMessage` `<img>`** to swap to a "tap to retry"
   state when the signed URL 404s or expires, instead of a broken glyph.
4. **Add `frontend/app/(protected)/chat/[characterId]/error.tsx`** (a client
   error boundary) so a render fault shows a scoped "reload chat" panel and
   the link never appears "broken".
5. **Check the persisted shape.** Confirm how user-uploaded input images are
   stored: if they are persisted as raw base64 in `Message.content`, that is
   the real defect. Plan to store them as a `MediaAsset` (S3 key) like
   assistant images and reference by id, so history never carries multi-MB
   data URLs (which also hurts the #5 chat-load waterfall). Treat the base64
   render-guard (steps 1-2) as the immediate fix and the storage change as
   the durable fix; both are in scope.

### Edge cases
- Legacy messages already stored as base64 must still render (keep the
  data-URL path working for old rows even after new rows use MediaAsset).
- Expired CloudFront signed URLs on old chats: `onError` retry via
  `/api/media` re-sign.
- Assistant image still generating (`status != ready`): keep the existing
  "Generating image..." placeholder (`ImageMessage.tsx:29`).
- Very long histories with several images must not blow up the DOM (ties to
  #5 message windowing).

### Sanity checks
- Repro locally: attach an image in the composer, send, receive an image
  reply, reload the `/chat/<id>` link -> page renders, both images show, no
  console throw.
- Force a 404 signed URL -> retry affordance appears, page stays alive.
- Malformed/empty `content` row -> error boundary (if it slips through)
  instead of a white screen.

### Regression guards
- Snapshot/RTL test for `ChatWindow` rendering a mixed history (text + inline
  data-URL image + ready S3 image + generating placeholder).
- Ensure text messages that happen to contain the literal word "data:" are
  not misclassified as images (match `^data:image/`).

---

## F. Issue #2 - Chat input does not auto-focus

### Symptom
On chat load the cursor is not in the input; user must click.

### Root cause (traced)
- `frontend/components/chat/ChatWindow.tsx:500-514`: the `<textarea>` has no
  `autoFocus` and none of the three `useEffect`s (`:123,:221,:234`) focus the
  `inputRef`.
- It is also `disabled={pending || paywall !== null}` (`:510`); if a check-in
  message streams on mount, `pending` is true and focus would be blocked.

### Change
1. Add a mount effect (client component, runs post-hydration) that calls
   `inputRef.current?.focus()` once the textarea is enabled. Guard against
   focusing while `disabled`.
2. Re-focus when `pending` transitions back to false (so after the check-in
   stream finishes, the cursor lands in the box). Debounce so it does not
   fight user focus elsewhere.
3. Do NOT steal focus on mobile if it would force the keyboard open
   disruptively; gate the auto-focus to pointer-capable / desktop widths (or
   respect a reduced-intrusion check). Keep behavior conservative on small
   screens.

### Edge cases
- Paywall active on load: do not focus a disabled input; focus once/if it
  becomes enabled.
- User already scrolled up reading history: initial mount focus is fine, but
  do not yank focus on every re-render.
- SSR: focus logic must be in an effect, never during render.

### Sanity checks
- Load a chat on desktop -> cursor blinking in the input immediately, can
  type without clicking.
- Load a chat that starts with a streaming check-in -> focus lands after the
  stream completes.
- Mobile: no jarring keyboard behavior / matches product expectation.

### Regression guards
- Ensure auto-focus does not break the existing keydown submit handler
  (`onInputKeyDown`) or the paywall disable state.

---

## G. Issue #3 - Paid tier shows "Pro"; hide the upsell pill for paying users

### Symptom
(3.i) The top-header "Premium 70% OFF" pill shows even to users who already
upgraded. (3.ii) Paid users see the label "Pro" in the bottom-left avatar
badge; it should read "Premium".

### Root cause (traced)
- Enum has three tiers: `free`, `premium`, `pro`
  (`schema.prisma:33-37`). Paid = `premium` OR `pro`.
- Badge renders the raw tier string:
  `frontend/components/app-shell/ProfileMenu.tsx:228` (`{tier}`), so a `pro`
  user literally shows "Pro". Tier flows from
  `frontend/app/(protected)/layout.tsx:47-52` (`tier:
  user.subscriptionTier`).
- Upsell pill: `frontend/components/app-shell/PremiumPill.tsx` rendered
  UNCONDITIONALLY at `frontend/app/(protected)/layout.tsx:71` (`<PremiumPill
  />`).

### Change (locked: display-only, no DB/enum/billing changes)
1. **Label map.** In `ProfileMenu.tsx` (the `TierBadge`, `:199-231`), map the
   display label: `free -> "Free"`, `premium -> "Premium"`,
   `pro -> "Premium"`. Keep the existing paid-vs-free styling
   (`isPaid = key !== "free"`). Do NOT change the stored value.
2. **Hide the pill for paid users.** The layout is a server component that
   already loads `user.subscriptionTier` (`layout.tsx:23`). Render
   `<PremiumPill />` only when `user.subscriptionTier === "free"`
   (`layout.tsx:71`). Pass tier down or branch in the server component.
3. **Audit any other place that prints the tier string to users** (grep for
   `subscriptionTier`, `tier`, "Pro"). Anywhere a user-facing label is
   derived from the tier, route it through the same label map. Backend
   internal logic (`grant.ts`, `provider.ts:premiumModel = tier === "pro"`,
   webhooks) is intentionally untouched.
4. Consider a single shared `tierLabel(tier)` helper in
   `packages/shared` so the mapping lives in one place and cannot drift
   between badge, billing page, and any future surface.

### Edge cases
- `premiumModel` gating stays `tier === "pro"`; do not let the label change
  fool anyone into changing the gate (a "premium"/daily-pass user is NOT a
  pro/recurring user for the premium-model feature). Add a code comment where
  the label map lives noting that display != capability.
- Billing/upgrade page: a paid user landing there directly should see
  upgrade/manage state, not the 70% pill; verify the pill is the only
  offending surface or apply the same guard.

### Sanity checks
- Local: set a test user to `pro` -> badge shows "Premium", header pill gone.
  Set to `premium` -> badge "Premium", pill gone. Set to `free` -> badge
  "Free", pill visible.
- `npm run check:no-em-dash`, typecheck, build.

### Regression guards
- No Prisma migration in this section (assert `git diff` touches no
  `schema.prisma`, no webhook, no `grant.ts`).

---

## H. Issue #4 - Meta Pixel "Lead" event never fires on signup

### Symptom
Pixel ID configured, `Lead` call exists on signup, but the event is never
captured.

### Root cause (traced, high confidence)
- Base pixel + `fbq` init load in `frontend/app/layout.tsx:62-73` from
  `https://connect.facebook.net/en_US/fbevents.js`; `Lead` is fired
  correctly at `frontend/app/signup/SignupForm.tsx:61` via the retry helper
  `frontend/lib/marketing/meta-pixel.ts`.
- **CSP blocks the script.** `frontend/next.config.ts:47` `script-src` is
  `'self' 'unsafe-inline' https://accounts.google.com` (+ dev eval) and does
  NOT include `https://connect.facebook.net`. So `fbevents.js` fails to load,
  only the stub queue exists, `metaTrack` exhausts its retries
  (`meta-pixel.ts:54-65`), and `Lead` is silently dropped. `connect-src`
  already allows `https:` so the XHR half would work once the script loads.

### Change
1. Add `https://connect.facebook.net` to the `script-src` directive in
   `frontend/next.config.ts:47`. Keep `'unsafe-inline'` (fbq init is inline).
   Verify `img-src` allows `https://www.facebook.com` (the tracking pixel
   `<img>` fallback / noscript) and `connect-src` covers
   `connect.facebook.net` (the `https:` wildcard does, but prefer an explicit
   entry for clarity).
2. Do not hardcode-vs-env churn: the Pixel ID is hardcoded
   (`layout.tsx:71,79`, `2065090824399737`); leave as-is unless you want it
   env-driven (optional, out of scope).

### Edge cases
- `Lead` must fire BEFORE the redirect to `/dashboard`
  (`SignupForm.tsx:62`); the existing fire-and-forget ordering is fine once
  the script loads. Verify the redirect does not race the queued event
  (fbq's queue survives navigation, but confirm in-network-tab).
- Ad blockers will still block the pixel for some users; that is expected and
  not a bug.
- Server-side/Conversions API is out of scope unless requested.

### Sanity checks
- Load signup with the Meta Pixel Helper extension -> `PageView` fires, no
  CSP violation in console for `connect.facebook.net`.
- Complete a signup -> `Lead` event appears in the Pixel Helper and in
  Events Manager Test Events.
- `[PROD-GATE]` The CSP change ships via Amplify env/build; deploy is
  approval-gated. Verify in prod with Test Events after deploy.

### Regression guards
- Confirm the new CSP entry does not broaden beyond `connect.facebook.net`;
  keep the allowlist tight. Re-check Google auth still works (accounts.google
  entry untouched).

---

## I. Issue #5 - Performance (lazy load, virtualization, slow pages)

### Symptom
Discover, dashboard, chat, and public `/gallery` are slow; many images load
at once; "Browse More" and opening a chat feel laggy.

### Root cause (traced)
- **Images**: grids use raw `<img>` (`components/gallery/CharacterCard.tsx:60-76`),
  no `next/image`, no responsive `srcset`/AVIF, only first 4 eager. 24 images
  requested per page on discover/gallery/dashboard.
- **Chat load waterfall**
  (`app/(protected)/chat/[characterId]/page.tsx:20-217`): sequential auth ->
  character+media -> conversation upsert -> 50 messages (`take:50`, `:67-72`)
  -> a big parallel batch (relationship, 50 sidebar conversations, bond, 6
  memories, quota) -> then a BLOCKING server-side `await blurMany(...)`
  (`:146`, `lib/media-blur.ts:86-116`) that fetches from S3 and runs sharp
  resize+blur+webp for every carousel image before the page can render.
- **No virtualization lib** in `frontend/package.json`.
- **Dashboard** calls `listCharacters` 4x (`lib/feed.ts:32-51`), two return
  identical data.

### Change (ordered by impact)
1. **Defer/parallelize the chat blur (biggest chat win).** Do NOT block
   render on `blurMany`. Either (a) precompute blur placeholders at
   image-creation time and store them (so read path is free), or (b) move
   blur generation off the critical path (stream the page, hydrate blurs
   client-side / on-demand). Target: chat page TTFB no longer scales with
   image count.
2. **Parallelize the chat loader.** Fetch character/media, conversation,
   history, sidebar, bond, memories, quota concurrently where there is no
   true dependency (conversation upsert must precede history by
   conversationId; everything else can overlap). Reduce sidebar
   `listConversations` from 50 to what the UI shows, with pagination.
3. **Window the message history.** Load the last ~20-30 messages initially
   (not 50) and lazy-load older on scroll-up. Ties into #1 (large base64
   rows) - once input images are MediaAssets, history payloads shrink.
4. **Adopt `next/image` for character cards** with correct `sizes`, `fill`,
   `loading="lazy"` (except a small number of above-the-fold priority
   images), and AVIF/WebP. Configure `images` remotePatterns in
   `next.config.ts` for the CloudFront/S3 host and `/api/media`. This gives
   real lazy loading + smaller bytes. If `next/image` with signed URLs is
   awkward, at minimum switch all cards to `loading="lazy"` +
   `decoding="async"` + intrinsic width/height to stop layout thrash.
5. **Infinite scroll with IntersectionObserver** on discover/gallery
   "Browse More" (there is already an IO pattern in `reels/ReelScroller.tsx`
   to mirror) so the next page prefetches as the sentinel nears the viewport
   instead of a click that then waits on 24 renders.
6. **Virtualize only where lists are truly long.** The grids are 24/page, so
   windowing is lower priority than image bytes and the chat waterfall. If a
   long list exists (e.g. full chat history, large galleries), add
   `@tanstack/react-virtual`. Do not add a virtualization lib for 24-item
   grids; lazy images + paged fetch is the right tool there.
7. **Dashboard**: collapse the duplicate `listCharacters` calls
   (`feed.ts:49` "For you" == "Popular"); fetch each distinct section once.

### Edge cases
- `next/image` + CloudFront signed URLs: signatures change per request;
  ensure the optimizer caching and the `/api/media` re-sign path still work.
  Test mature-content blur (currently `blur-lg` on full-res) still gates
  correctly and does not leak an unblurred optimized variant.
- Age-gate: lazy-loaded images beyond the fold must still respect
  content-rating gating.
- Do not regress the known-good prod media wiring (Amplify WEB_COMPUTE +
  `/api/media` presign). Any `next.config` image change must be verified
  against the prod S3 endpoint behavior, not just local MinIO.
- Keep SSR/RSC data-fetch correctness; parallelization must not introduce a
  read of `conversationId` before the upsert.

### Sanity checks
- Lighthouse / Web Vitals before vs after on discover, gallery, dashboard,
  chat (record LCP, TBT, bytes transferred).
- Network tab: character grid transfers AVIF/WebP, off-screen images are
  lazy, "Browse More" prefetches.
- Chat page TTFB is flat regardless of how many carousel images a character
  has (blur no longer blocking).
- No visual regression on cards, blur gating, or carousel.

### Regression guards
- Verify no hydration mismatch from `next/image`.
- Verify the media presign/`/api/media` path and mature-blur still work
  against real S3 (not just local), per the prod-architecture known-good
  note.
- `npm run build` bundle size does not balloon from a needless
  virtualization dep.

---

## Cross-cutting: verification checklist before any deploy

Run per touched workspace. Nothing below is optional.

- [ ] `npm run typecheck` (root + `frontend` + `backend` +
      `packages/database` + `packages/shared`).
- [ ] `npm run build` (frontend + backend).
- [ ] `npm run check:no-em-dash` (repo-wide, includes md/prisma/yaml).
- [ ] `npm test` in every workspace with new/changed logic (intent matcher,
      token-preservation guard, `pickDisplayMediaId`, dedupe idempotence,
      ChatWindow render).
- [ ] Prisma: `prisma validate`; migrations are additive (nullable columns /
      partial unique) and pass the `17-ship-all.sh` additive-drift guard.
- [ ] Manual repro of each symptom fixed, on desktop AND mobile widths where
      relevant.

## Prod execution runbook (ALL steps are [PROD-GATE], ask each time)

Per `CLAUDE.md`: never run any of these without a fresh, explicit,
per-action human "yes". List them so the human can approve deliberately;
do not chain approvals.

1. Apply migrations to prod DB (`add_character_seed_key`,
   `add_character_media_is_main`) via the normal `prisma migrate deploy`
   path in `17-ship-all.sh`. `[PROD-GATE]`
2. `pg_dump` the three character tables from prod (backup before dedupe).
   `[PROD-GATE]`
3. Run the prod-safe dedupe (`--i-understand-this-is-prod`) with dry-run
   diff reviewed and approved first. `[PROD-GATE]`
4. Run `sync-personas.ts` against prod to converge on 144 by `seedKey`.
   `[PROD-GATE]`
5. Wake the GPU box; run `bulk_generate_main.py --all --dry-run`, review the
   144-character manifest, then the real run; then the TS promoter to set
   `isMain`. `[PROD-GATE]` (GPU box may be down; script fails loud.)
6. Deploy frontend (CSP fix for pixel, tier label, pill hide, chat fixes,
   performance) + backend (intent/image-gen changes) via the standard
   Amplify + ECS path. `[PROD-GATE]`
7. Post-deploy verification: Meta Test Events shows `Lead`; discover search
   returns unique personas; every character shows its fixed main image and
   it does not change after generating a chat image; chat links survive an
   image round-trip; input auto-focuses; paid users see "Premium" and no
   upsell pill; Web Vitals improved.

## Explicitly out of scope (YAGNI)

- Renaming the DB `pro` enum value or collapsing tiers (locked: display-only).
- Forcing globally unique persona names (locked: keep legit repeats).
- Meta Conversions API / server-side pixel.
- Rewriting the existing `bulk_generate_v2.py` / `bulk_generate_llm.py`.
- Full virtualization of short (24-item) grids.
