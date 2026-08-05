# Phase 03: Character gallery & discovery

## Goal
Ship the public discovery surface: a browsable grid of character cards (avatar, name, bio, tags) with sort (popular / new / trending), filter (style, tags, content rating), and search; a character detail page; and a restricted CTA that prompts unauthenticated visitors to sign up before they can chat. Back it with `GET /api/characters` (list, Zod-validated query, paginated) and `GET /api/characters/:id` (detail). For authed users, add a dashboard/feed that surfaces "continue chatting" recents plus categorized feeds. This is a read-only phase over the schema and system-character seed from Phase 02; no chat or creation yet.

Covers PRD §5.2 (character system / gallery & discovery) and §3 (personas & journeys: Visitor → gallery preview → auth → dashboard/feed).

## Prerequisites
- Phases 00–02 green: monorepo scaffold, `packages/database` Prisma singleton (`import { prisma } from "@buttercupp/database"`), `packages/shared` Zod DTOs, cookie JWT auth + middleware guards (Phase 01), full Prisma schema + migrations + system-character seed (Phase 02).
- Seeded `system` characters exist (ownerUserId null, moderationStatus approved, mix of `visibility=public`, `contentRating` sfw|mature, styles realistic|3d|anime) with `popularityScore` populated so sort has signal.
- `Character`, `CharacterVersion`, `AppearanceSheet`, `VoiceProfile` tables and `RelationshipState` / `Conversation` tables present (dashboard recents read from `Conversation`).

## Context to paste into Cursor
Paste this block at the top of the Cursor agent session:

> Building ButterCupp Phase 03 (character gallery & discovery). Read `prds/master-prd.md` §5.2 and §3 first. Mirror Pellow conventions: Prisma singleton `import { prisma } from "@buttercupp/database"` (never `new PrismaClient()`), Zod DTOs live in `packages/shared`, Next.js 16 App Router server components by default, Tailwind 4 + shadcn/ui, design tokens as CSS vars, TypeScript strict. No em dashes anywhere. Auth/session helpers from Phase 01 (`frontend/lib/auth.ts`, cookie JWT via `jose`) already exist; reuse `getSession()`/middleware rather than reimplementing.
>
> Reference Pellow paths for patterns:
> - Prisma singleton + query style: `../Pellow/packages/database/src/client.ts`
> - Server-centric route + Zod query validation: any `../Pellow/frontend/app/api/*/route.ts`
> - Card/grid component + design tokens: `../Pellow/frontend/app/globals.css`, `../Pellow/.cursor/skills/vesspr-design-language/SKILL.md`
> - Restricted-visitor CTA pattern: how Pellow gates unauthenticated users in `../Pellow/frontend/middleware.ts`
>
> Locked decision: mature content is first-class (PRD §0). Mature characters must be gated. Visitors and non-age-verified users must never see mature cards unblurred and must be prompted to sign up / age-verify at the chat CTA.

## Build steps
Do these in order. Name files exactly as below.

1. **Shared DTOs and query schema**: `packages/shared/src/characters.ts`
   - Export `characterSortSchema = z.enum(["popular", "new", "trending"])`.
   - Export `characterListQuerySchema` = Zod object: `sort` (default `"popular"`), `style` (optional `z.enum(["realistic","3d","anime"])`), `tags` (optional `string[]`, comma-split coerce), `contentRating` (optional `z.enum(["sfw","mature"])`), `q` (optional search string, `assertSafeString`-guarded, max 100), `cursor` (optional cuid), `limit` (default 24, max 48). Keyset pagination via `cursor`, not offset.
   - Export `CharacterCardDTO` type (id, name, bio, tags, style, contentRating, avatarUrl, popularityScore) and `CharacterDetailDTO` (card fields + greeting, personality summary, creator label system|community, version metadata).
   - Re-export from `packages/shared/src/index.ts`.

2. **Query builder (unit-testable, pure)**: `backend/src/characters/query.ts`
   - Export `buildCharacterWhere(input, viewer)` returning a Prisma `where` object. Rules: always `visibility=public` AND `moderationStatus=approved`; apply `style`, `tags` (hasSome), `contentRating`, and `q` (case-insensitive `contains` on name/bio/tags). Mature gating: if `viewer` is not age-verified for mature (visitor or unverified member), force `contentRating="sfw"` regardless of the requested filter.
   - Export `buildCharacterOrderBy(sort)`: `popular` → `popularityScore desc`; `new` → `createdAt desc`; `trending` → a recency-weighted score expression (comment: `popularityScore` decayed by age; for MVP use `popularityScore desc, createdAt desc` and leave a TODO for a materialized trending score).
   - Keep this file free of Prisma client calls (pure input → query object) so Vitest can assert the shape without a DB.

3. **List endpoint**: `frontend/app/api/characters/route.ts`
   - `GET`: parse `searchParams` through `characterListQuerySchema`; resolve viewer via `getSession()` (nullable = visitor); call a thin `listCharacters()` service (`frontend/lib/characters.ts`) that uses `buildCharacterWhere` + `buildCharacterOrderBy`, selects only card fields (join current `CharacterVersion` for avatar/greeting via `AppearanceSheet.referenceImageKeys[0]`), applies keyset pagination (`take: limit+1`, derive `nextCursor`). Return `{ items: CharacterCardDTO[], nextCursor }`. Validation failure → 400 with Zod issues.

4. **Detail endpoint**: `frontend/app/api/characters/[id]/route.ts`
   - `GET`: `assertSafeId(id)`; fetch character + current version + appearance/voice summary. 404 if not found, not public, or not approved (unless the viewer is the owner). Mature detail for a non-verified viewer returns a gated payload (metadata + `requiresAgeVerification: true`, no mature imagery). Return `CharacterDetailDTO`.

5. **Gallery page (server component)**: `frontend/app/(public)/gallery/page.tsx`
   - Server-fetch first page via the list service (reads `searchParams` for sort/filter/q so URLs are shareable and SSR-friendly). Render `<GalleryToolbar>` + `<CharacterGrid>`.
   - `frontend/components/gallery/GalleryToolbar.tsx` (client): sort dropdown, style/tags/rating filters, debounced search box; pushes state into the URL query (`router.replace`) so server re-renders. Mature filter is hidden/disabled for non-verified viewers.
   - `frontend/components/gallery/CharacterCard.tsx`: avatar, name, bio (clamped), tag chips, a subtle content-rating badge; mature cards for non-verified viewers render blurred with an "18+ / verify to view" overlay.
   - `frontend/components/gallery/CharacterGrid.tsx`: responsive grid + "Load more" using `nextCursor` (client fetch to `/api/characters`).

6. **Detail page + restricted CTA**: `frontend/app/(public)/characters/[id]/page.tsx`
   - Server-fetch detail. Render hero (avatar, name, tags, bio, greeting preview). CTA button `<ChatCTA>` (`frontend/components/gallery/ChatCTA.tsx`): if visitor → opens signup/age-gate prompt (link to Phase 01 flow); if member but character is mature and viewer not verified → prompt age verification; if eligible → link to `/chat/[characterId]` (route lands in Phase 04, stub the href now).

7. **Authed dashboard / feed**: `frontend/app/(app)/dashboard/page.tsx`
   - Guarded by middleware. Server-fetch: (a) "Continue chatting" recents = user's `Conversation` rows ordered by `lastMessageAt`, joined to character card fields; (b) categorized feeds = reuse the list service with preset queries (e.g. Popular, New this week, by top tags). Render recents rail + feed sections using the same `CharacterCard`.
   - `frontend/lib/feed.ts`: `getDashboardFeed(userId)` composing the above.

8. **Popularity signal (write side, minimal)**: in `frontend/lib/characters.ts` add a fire-and-forget `bumpCharacterView(characterId)` helper (increment a lightweight view counter feeding `popularityScore`; guard against auth-required, do not block the response). Wire it into the detail page load. Mirror Pellow's fire-and-forget `audit.ts` write style.

9. **Wire nav**: add gallery + dashboard links to the existing header/nav; visitors see "Browse", authed users see "Dashboard".

## Test instructions
- **Vitest (query building, pure):** `backend/src/characters/__tests__/query.test.ts`
  - `buildCharacterWhere` always sets `visibility=public` + `moderationStatus=approved`.
  - A visitor / unverified viewer forces `contentRating="sfw"` even when `contentRating="mature"` is requested.
  - `style`, `tags` (hasSome), and `q` (name/bio contains) map into the where object as expected.
  - `buildCharacterOrderBy` returns the right order for popular/new/trending.
  - Run: `npm run test -w backend -- characters/query`.
- **Playwright (E2E):** `frontend/e2e/gallery.spec.ts`
  - Visitor loads `/gallery`, sees seeded system character cards.
  - Visitor changes sort and applies a style filter; grid updates (URL query changes, results differ).
  - Visitor types in search; results filter.
  - Visitor opens a character detail page and clicks the chat CTA → is prompted to sign up (not routed into chat).
  - Run: `npm run test:e2e -w frontend -- gallery`.
- **Manual:** `npm run dev`, open `/gallery` unauthenticated, confirm mature cards are blurred/gated; sign in as a seeded verified user and confirm mature cards render and `/dashboard` shows recents + feeds.

## Sanity checklist
- [ ] Mature characters never render unblurred for a visitor or a non-age-verified member; the mature filter is unavailable to them.
- [ ] Pagination works: "Load more" fetches the next keyset page and does not duplicate cards; `nextCursor` is null on the last page.
- [ ] Cards render from the Phase 02 seeded system characters (avatar from AppearanceSheet, name, bio, tags all populated).
- [ ] Sort popular/new/trending each change ordering; filters and search compose (multiple filters at once narrow results).
- [ ] Chat CTA for a visitor prompts signup; for an eligible member it links to the chat route (stub OK).
- [ ] `/dashboard` is middleware-guarded (visitor is redirected) and shows "continue chatting" recents from `Conversation`.
- [ ] All query parsing goes through Zod; malformed query params return 400, not a 500.

## Done criteria
"Green" = Vitest query-builder suite passes, the Playwright gallery spec passes, mature gating holds for unauthenticated viewers, pagination + sort + filter + search all work against seeded data, and the authed dashboard renders recents and categorized feeds. No chat or creation behavior is required yet (those are Phases 04 and 06).

## Guardrail note
Do not commit, push, run a non-local migration, or deploy as part of this phase. If a schema tweak is needed (for example a view-counter column), generate the migration locally only and STOP to ask for explicit human approval before applying it anywhere non-local. Every commit, push, deploy, or non-local DB change requires a fresh, explicit, per-action human approval.
