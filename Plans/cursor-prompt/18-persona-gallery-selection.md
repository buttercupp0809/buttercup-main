# Phase 18: Persona discovery and selection (Candy/Nastia style)

## Goal
Upgrade Discover/gallery from plain bordered cards into an **image-forward, cinematic selection experience** matching the dark app shell from Phase 17. Restyle the existing gallery components into large persona cards with a gradient scrim, a name + tagline overlay, an online/mood dot, and tasteful hover motion. Keep and improve the toolbar filters (style, tags, rating, popular/new/trending) plus search. Restyle the character detail page into an immersive layout with a "Start chat" CTA. The **same** components serve both the public `(public)/gallery` + `(public)/characters/[id]` routes and the in-app Discover (which reuses `/gallery`). Mature-content blur and age-gating for unverified users must be preserved exactly.

This is a **visual layer** over existing gallery data and gating. Query builder, list/detail endpoints, DTOs, and mature gating logic are unchanged. Covers PRD (experience-monetization) §2.4 and §1 (design direction).

## Prerequisites
- Phase 17 green (dark app shell, `.poppy-app` theme tokens including `--poppy-accent-rose`, `--poppy-accent-violet`, `.poppy-scrim`, and the Fraunces display / body sans font pairing).
- Existing gallery stack from Phase 03 intact:
  - `frontend/components/gallery/CharacterCard.tsx` (4:5 image, name, bio clamp, tag chips, content-rating badge, mature blur + "18+ verify to view" overlay when `contentRating === "mature" && !viewerAllowsMature`).
  - `frontend/components/gallery/CharacterGrid.tsx` (responsive grid + "Load more" via `nextCursor`, client-fetches `/api/characters`).
  - `frontend/components/gallery/GalleryToolbar.tsx` (client; sort/style/rating selects + debounced search, pushes state into the URL via `router.replace`; mature rating hidden when `!viewerAllowsMature`).
  - `frontend/components/gallery/ChatCTA.tsx` (states: `visitor` -> signup, `needsAgeGate` / `needsAgeGateMature` -> age gate, `eligible` -> `Link` to `/chat/{id}`).
  - `frontend/app/(public)/gallery/page.tsx` (server; parses `searchParams` through `characterListQuerySchema`, calls `listCharacters(query, viewer)`, renders `GalleryToolbar` + `CharacterGrid`).
  - `frontend/app/(public)/characters/[id]/page.tsx` (server; `getCharacterDetail`, fire-and-forget `bumpCharacterView`, computes `ChatCTAState`, renders hero + tags + greeting; gated mature payload sets `requiresAgeVerification`).
- DTO contracts (do not change): `CharacterCardDTO` (id, name, bio, tags, style, contentRating, avatarUrl, popularityScore, createdAt) and `CharacterDetailDTO` (card fields + greeting, personalitySummary, creatorLabel, version, requiresAgeVerification?) in `packages/shared/src/characters.ts`.
- `frontend/lib/viewer.ts` `getViewer()` and `viewerAllowsMature(viewer)` from `@poppy/database` gate mature content. Endpoints `/api/characters` and `/api/characters/[id]` already enforce gating server-side.
- Playwright runs from repo root `e2e/` (baseURL `http://localhost:3000`); `e2e/gallery.spec.ts` already exercises visitor gallery, filters, search, and the CTA-prompts-signup path.

## Context to paste into Cursor
Paste this block at the top of the Cursor agent session:

> Building Poppy Phase 18 (persona discovery and selection, Candy/Nastia style). Read `prds/experience-monetization-prd.md` §2.4 and §1 first. This is a restyle over existing gallery data and gating: do NOT change the query builder, the `/api/characters` list/detail endpoints, the Zod query schema, the `CharacterCardDTO` / `CharacterDetailDTO` shapes, or the mature-gating rules. Server-side mature gating and age-gating stay authoritative; the UI only reflects it.
>
> Conventions: Next.js 16 App Router, server components by default, `"use client"` only for the toolbar and any hover/interaction logic. Prisma singleton `import { prisma } from "@poppy/database"`. Tailwind 4, design tokens as CSS vars, reuse `.poppy-app` / rose / violet / `.poppy-scrim` tokens from Phase 17, `cn()` from `frontend/lib/utils`, `.font-display` (Fraunces) for names/headings. TypeScript strict. No em dashes anywhere.
>
> Design (PRD §1): image-forward large cards with a gradient scrim, name + tagline overlaid on the image, an online/mood dot, hover lift + slow image zoom, staggered reveal on load. The detail page is immersive: large hero image with scrim, name in the display face, tagline, tags, greeting preview, and a bold "Start chat" CTA. Keep mature cards blurred with the "18+ verify to view" overlay for unverified viewers.
>
> The same restyled components must serve both the public gallery routes and the in-app Discover (the sidebar "Discover" item routes to `/gallery`). Keep the public route usable without auth; when rendered inside the app shell it inherits the dark theme.

## Build steps
Do these in order. Name files exactly as below. Restyle in place; do not fork components.

1. **Card restyle** `frontend/components/gallery/CharacterCard.tsx`
   - Keep the `CharacterCardProps` contract (`character: CharacterCardDTO`, `viewerAllowsMature: boolean`) and the optional `relationship?` prop added in Phase 17. Keep `data-testid="character-card"` and the `Link` to `/characters/{id}`.
   - Move to a **full-bleed image card**: the 4:5 image fills the card; overlay a bottom gradient scrim (`.poppy-scrim` or a `bg-gradient-to-t from-black/80 via-black/20 to-transparent`). Overlay, at the bottom, the **name** (`.font-display`, white) and a **tagline** (first line of bio or a dedicated short line, clamped to 1 line). Tag chips render as small translucent pills on the scrim (max 3).
   - **Online/mood dot**: top-left, a small dot. Rose when `relationship?.affectionLevel > 0` or `relationship?.mood` present; otherwise a neutral "available" dot. Add `title`/`aria-label` describing it.
   - **Content-rating badge** stays (top-right), restyled translucent.
   - **Hover motion**: on `group-hover`, lift the card (`-translate-y-1`) and slow-zoom the image (`scale-105`, `duration-500`), raise the scrim slightly. Respect `prefers-reduced-motion` (disable transforms).
   - **Mature gating unchanged**: when `contentRating === "mature" && !viewerAllowsMature`, blur the image (`blur-lg`) and show the centered "18+ verify to view" overlay exactly as today. The name/tagline overlay must not leak mature imagery (keep it readable but the image stays blurred).

2. **Grid restyle + staggered reveal** `frontend/components/gallery/CharacterGrid.tsx`
   - Keep the `initialItems` / `initialNextCursor` / `viewerAllowsMature` props and the "Load more" fetch to `/api/characters` (same query params, same `nextCursor` keyset behavior). Do not duplicate cards; `nextCursor === null` hides the button.
   - Tighten the responsive grid for larger image cards (e.g. `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, `gap-3 md:gap-4`).
   - Add a subtle staggered fade/rise reveal on mount (CSS animation with per-item `animation-delay` via inline style index, capped). Newly loaded pages animate in too. Guard with `prefers-reduced-motion`.

3. **Toolbar restyle + tag filter** `frontend/components/gallery/GalleryToolbar.tsx`
   - Keep it client, keep the URL-driven pattern (`router.replace`, drop `cursor` on change, 300ms debounced search) and keep the mature rating select hidden when `!viewerAllowsMature`. These behaviors are tested; do not break them.
   - Restyle selects/search as dark pill controls (surface-2 background, rose focus ring). Render sort as a segmented control (Popular / New / Trending) writing `sort` to the URL, so the three sort modes are one tap each. Keep the `<select>` fallbacks accessible (`aria-label`s already present).
   - **Tags filter (new, additive to the existing `tags` query param the schema already supports):** accept an optional `availableTags?: string[]` prop; render up to N tag chips that toggle membership in the `tags` URL param (comma-joined, matching `characterListQuerySchema`'s comma-split coercion). If `availableTags` is not provided, omit the tag row (no behavior change). Active tag chips are rose-filled.
   - Add `data-testid` hooks: `sort-popular`, `sort-new`, `sort-trending`, `filter-style`, `filter-rating`, `search-input`, and `tag-{slug}` for tag chips.

4. **Optional available-tags source** `frontend/lib/characters.ts`
   - Add a cheap `getFacetTags(viewer)` that returns a small deduped list of popular tags from approved/public characters the viewer may see (e.g. `select tags` on the same `buildCharacterWhere` filter, flatten, count, top 12). Keep it optional and cache-friendly; if it is not wired, the toolbar simply omits the tag row. Do not change `buildCharacterWhere`.

5. **Gallery page (public + in-app Discover)** `frontend/app/(public)/gallery/page.tsx`
   - Keep the existing parse of `searchParams` through `characterListQuerySchema`, `getViewer()`, `listCharacters(query, viewer)`, and `viewerAllowsMature(viewer)`. Do not change the data flow.
   - Pass `availableTags={await getFacetTags(viewer)}` into `GalleryToolbar` (or omit if you skip step 4).
   - Restyle the header: `Discover` in `.font-display`, a one-line subhead. Since this route now serves both public and in-app Discover, ensure it looks correct on the dark theme when nested in the app shell and still acceptable on the public shell (the page itself can wrap its content in a neutral container; the app shell supplies `.poppy-app`). Do not add auth requirements to this public route.

6. **Immersive detail page** `frontend/app/(public)/characters/[id]/page.tsx`
   - Keep the data flow: `await params`, `getViewer()`, `getCharacterDetail(id, viewer)`, `notFound()` on null, fire-and-forget `bumpCharacterView(detail.id)`, and the exact `ChatCTAState` computation (visitor -> `visitor`, gated mature -> `needsAgeGateMature`, member not age-verified -> `needsAgeGate`, else `eligible`). Keep `requiresAgeVerification` gating and the blurred hero for gated viewers.
   - Restyle into an immersive layout: a large hero image (respect `gated && blur-lg`) with a scrim; overlay the name (`.font-display`, large), the creator/rating/style meta row, and the tagline. Below or beside, render bio, tags (rose-tinted chips), `personalitySummary`, and the greeting preview (italic, quoted) exactly as the data allows, all restyled for dark.
   - The `<ChatCTA state={ctaState} />` stays the selection action. Its `eligible` state already links to `/chat/{id}` (which creates/opens a conversation in the chat page). Make the CTA visually prominent (rose gradient button). Keep the gated amber notice for `requiresAgeVerification`.
   - Optionally show `<AffectionMeter>` (Phase 17) when a `RelationshipState` exists for an authed viewer (fetch via `getRelationship`), but never for visitors and never leaking mature imagery.

7. **In-app Discover parity check**
   - Confirm the Phase 17 sidebar "Discover" item points to `/gallery` and that the restyled gallery + card + detail render correctly within `.poppy-app`. No separate Discover route is needed; the public route is the single source. If any wrapper styles fight the dark shell, scope fixes to the gallery components, not the shell.

8. **Reduced-motion + accessibility pass**
   - All hover/zoom/stagger animations are wrapped in `@media (prefers-reduced-motion: reduce)` no-op guards. Cards remain fully keyboard-focusable (the whole card is a `Link`); the online/mood dot and rating badge have text alternatives; scrim text meets AA contrast against the darkened image (the scrim guarantees this, note it in a comment).

## Test instructions
- **Playwright (E2E):** extend `e2e/gallery.spec.ts` (and/or add `e2e/persona-selection.spec.ts`):
  - Visitor loads `/gallery`, sees seeded system character cards (`character-card` present, image-forward with name overlay).
  - Sort segmented control: click `sort-new` then `sort-trending`, assert the `sort` URL param changes and the grid re-renders (order differs from popular). Apply a style filter and assert results narrow. Type in `search-input` and assert filtering.
  - If tag chips are wired: click a `tag-{slug}` chip, assert the `tags` URL param updates and results narrow; click again to deselect.
  - Mature blur respected: as a visitor/unverified viewer, any mature card renders blurred with the "18+ verify to view" overlay, and the mature rating filter is not available. As a seeded verified user, mature cards render unblurred.
  - Detail + Start chat: open a character detail page; for an eligible (verified) user, click the "Start chat" CTA and assert the browser routes to `/chat/{id}` and the chat surface loads (conversation created/opened). For a visitor, assert the CTA prompts signup and does NOT route into chat.
  - Run: `npm run test:e2e -- gallery` and `npm run test:e2e -- persona-selection` (if added).
- **Playwright (regression):** run the full suite to confirm Phase 17 `app-shell` and `auth-age-gate` specs still pass. Run: `npm run test:e2e`.
- **Vitest (unit, if step 4 added):** a small test for `getFacetTags` flattening/dedup/top-N logic (extract the pure reduce into a helper so it tests without a DB). Run: `npm run test -w frontend -- facet`.
- **Manual:** `npm run dev`; browse `/gallery` as a visitor (cinematic image cards, mature blurred), in the app as a verified user via the sidebar Discover item (dark theme, mature unblurred), open a detail page (immersive hero), and click Start chat to land in `/chat/{id}`.

## Sanity checklist
- [ ] Cards are image-forward with a gradient scrim, name + tagline overlay, online/mood dot, and hover lift/zoom; `data-testid="character-card"` and the link to `/characters/{id}` are unchanged.
- [ ] Filters (style, tags, rating) + sort (popular/new/trending) + search all still drive the URL and re-render the grid; "Load more" keyset pagination still works and never duplicates cards.
- [ ] Mature cards render blurred with the "18+ verify to view" overlay for visitors/unverified members; the mature rating filter stays hidden for them; verified users see mature content. Gating logic is unchanged (server authoritative).
- [ ] The detail page is immersive (hero + scrim + display-face name + tagline + tags + greeting) and its `ChatCTAState` computation and gated-mature behavior are unchanged.
- [ ] "Start chat" for an eligible viewer routes to `/chat/{id}` and creates/opens a conversation; for a visitor it prompts signup and does not enter chat.
- [ ] The same components serve the public gallery and the in-app Discover (`/gallery`); no data contract, query builder, endpoint, or DTO was changed.
- [ ] Animations respect `prefers-reduced-motion`; cards are keyboard-focusable; scrim text meets AA contrast.

## Done criteria
"Green" = the extended `gallery` (and optional `persona-selection`) Playwright specs pass, the full suite (including Phase 17 `app-shell` and `auth-age-gate`) still passes, mature blur and age-gating are preserved for unverified viewers, filters/sort/search/pagination all work against seeded data, the detail page is immersive, and "Start chat" routes eligible users into `/chat/{id}` while prompting visitors to sign up. The gallery data contracts and mature gating are unchanged.

## Guardrail note
Do not commit, push, run a non-local migration, or deploy as part of this phase. This is a pure UI restyle over existing data and endpoints; no schema change is expected. If any Prisma tweak ever seems necessary, generate the migration locally only and STOP to ask for explicit human approval before applying it anywhere non-local. Every commit, push, deploy, or non-local DB change requires a fresh, explicit, per-action human approval.
