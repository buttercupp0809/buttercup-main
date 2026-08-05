# Phase 14: Marketing landing + top nav + footer

## Goal
Turn Poppy's placeholder landing (`frontend/app/page.tsx`, a bare hero with two buttons) into a real marketing home page: a hero with dynamic companion previews pulled from real public characters, value props (unfiltered chat, voice, image, memory, create-your-own), a live persona carousel, social-proof band, and clear CTAs ("Create your companion" / "Browse"). Upgrade the public top bar in `frontend/app/(public)/layout.tsx` (currently "Poppy / Browse / Sign in / Sign up") into a polished marketing header with Log in + Sign up (and a Dashboard link for logged-in users). Add a site-wide `Footer` component that links every legal page (built in Phase 15), socials, an 18+ mark, and a company line, and mount it on the public shell.

This phase covers PRD (`prds/experience-monetization-prd.md`) §2.1 (marketing website: landing + footer) and §1 (design direction). Marketing may use a lighter hero; the dark in-app shell is Phase 17. This is a visual layer over existing data: the characters query, gallery, and character routes are unchanged.

## Prerequisites
- Existing public shell green: `frontend/app/(public)/layout.tsx`, `frontend/app/(public)/gallery/page.tsx`, `frontend/app/(public)/characters/[id]/page.tsx`.
- Existing characters read path works: `listCharacters(query, viewer)` in `frontend/lib/characters.ts`, `getViewer()` in `frontend/lib/viewer.ts`, `characterListQuerySchema` + `CharacterCardDTO` in `@poppy/shared`, `viewerAllowsMature` in `@poppy/database`.
- Phase 15 (legal pages) can run before or after, but the `Footer` links target `/legal/*` routes. If Phase 15 has not run yet, the links still render; they resolve once Phase 15 ships. Do NOT hardcode a different legal path.
- Local Postgres reachable so the landing can render real characters. If the DB is empty, the hero must degrade gracefully (see build step 3).

## Context to paste into Cursor
```
You are building Phase 14 of "Poppy" (mature-gated AI companion platform): the marketing landing page, an upgraded public top nav, and a site-wide footer.

Authoritative spec: prds/experience-monetization-prd.md. Read:
- §2.1 Marketing website: landing (/) has a hero with dynamic companion previews, value props (unfiltered chat, voice, image, memory, create-your-own), a live persona carousel pulling REAL public characters, social proof, and CTAs ("Create your companion", "Browse"). Top bar: logo, Browse, Log in / Sign up. Site-wide Footer links all legal pages + socials + an "18+" mark + a company line.
- §1 Design direction: the product app is dark and cinematic (Phase 17), but the MARKETING landing may use a lighter hero. Persona cards are large and image-forward with a gradient scrim, name + tagline overlay, and hover motion.

Reuse existing code, do not fork data access:
- Pull real public characters through the SAME read path the gallery uses: frontend/lib/characters.ts listCharacters(query, viewer), frontend/lib/viewer.ts getViewer(), characterListQuerySchema from @poppy/shared. Sort by "popular" (or "trending" if present) and take a small limit for the hero/carousel.
- CharacterCardDTO fields available: id, name, bio, tags, style, contentRating, avatarUrl (nullable), popularityScore, createdAt. There is NO tagline field: derive a short tagline from bio (truncate) for overlays. Respect mature gating exactly like CharacterCard.tsx: a mature card for a non-mature viewer must be blurred/gated, never shown clearly.
- The landing is a public server component (visitors are unauthenticated). Never require auth on / or the footer.

Hard rules: TypeScript strict; server-centric Next.js 16 App Router; no new PrismaClient (import { prisma } from "@poppy/database", but prefer going through frontend/lib/characters.ts); no em dashes anywhere; keep the existing public gallery + character-detail routes working unchanged.
Do NOT run git commit/push, deploy, or migrate a non-local DB.
```

## Build steps

### 1. Marketing data helper
- `frontend/lib/marketing.ts`. A small server helper `getLandingCharacters()` that calls `getViewer()` then `listCharacters(...)` with a query built from `characterListQuerySchema.parse({ sort: "popular", limit: 12 })` (use whatever sort keys the schema actually supports; fall back to default sort if "popular" is not a valid enum value). Return `{ items, viewerAllowsMature }` where `viewerAllowsMature` comes from `viewerAllowsMature(viewer)` in `@poppy/database`. Never throw: wrap in try/catch and return `{ items: [], viewerAllowsMature: false }` on any error so an empty/unreachable DB does not 500 the home page. Add a `taglineFrom(bio: string)` pure helper that trims bio to about 80 chars on a word boundary for card overlays.

### 2. Persona preview card (marketing variant)
- `frontend/components/marketing/PersonaPreviewCard.tsx`. A presentational card for a `CharacterCardDTO`: large image-forward tile, gradient scrim from the bottom, name + derived tagline overlay, a small online/mood dot, hover lift. Reuse the gating logic from `frontend/components/gallery/CharacterCard.tsx`: if `contentRating === "mature" && !viewerAllowsMature`, blur the image and show an "18+ verify to view" chip instead of the clear image. Wrap the card in a `Link` to `/characters/${id}` (public detail route, already exists). Give it `data-testid="persona-preview"`.

### 3. Hero + carousel
- `frontend/components/marketing/Hero.tsx`. Client component (needs a lightweight auto-advancing carousel). Props: `items: CharacterCardDTO[]`, `viewerAllowsMature: boolean`. Renders the headline, subhead, and the two primary CTAs, plus a preview strip/carousel of `PersonaPreviewCard`s.
  - Headline: a marketing line about unfiltered AI companions (18+). Subhead: one sentence.
  - CTAs: primary "Create your companion" -> `/signup` (a visitor must sign up before creating); secondary "Browse" -> `/gallery`. Use the existing `Button` component (`frontend/components/ui/button.tsx`).
  - Carousel: pure CSS/RAF or a tiny `setInterval` state advance, pausing on hover, keyboard-accessible (arrow keys move the active slide, focus-visible states). No external carousel lib. If `items` is empty, render a tasteful static placeholder strip (skeleton tiles) so the hero never looks broken.
- `frontend/components/marketing/ValueProps.tsx`. Five value props in a responsive grid: Unfiltered chat, Voice, Image, Memory, Create your own. Each is an icon + title + one line. Inline SVG icons only (no external icon fetches).
- `frontend/components/marketing/SocialProof.tsx`. A social-proof band: a short stat row and/or a couple of testimonial cards. Mark any invented numbers with a code comment `// PLACEHOLDER: replace with real metric before launch` so they are obviously not real.

### 4. Rebuild the landing page
- `frontend/app/page.tsx`. Convert to an `async` server component. Call `getLandingCharacters()`, then compose: `<Hero items=... viewerAllowsMature=... />`, `<ValueProps />`, `<SocialProof />`, and a closing CTA section repeating "Create your companion" / "Browse". Add `export const dynamic = "force-dynamic"` (the same directive the gallery page uses) so previews reflect live characters. Keep it inside the `(public)` route group so it inherits the upgraded header + footer. Do NOT remove the 18+ framing.

### 5. Upgrade the public top nav
- `frontend/app/(public)/layout.tsx`. Keep it a server component that resolves `getCurrentUser().catch(() => null)`. Upgrade the header: logo linking to `/`, a `Browse` link to `/gallery`, and on the right: if `user`, a `Dashboard` link; else `Log in` (-> `/login`) + a primary `Sign up` button (-> `/signup`). Rename the visible "Sign in" text to "Log in" to match the PRD. Make it responsive (a simple mobile menu or a wrapping flex row is fine). Mount the new `Footer` at the bottom of the shell so it appears site-wide on public routes. Do not add auth or age-gate logic here; visitors browse freely.

### 6. Site-wide footer
- `frontend/components/Footer.tsx`. Columns of links: Legal (`/legal/terms`, `/legal/privacy`, `/legal/cookie`, `/legal/content-policy`, `/legal/dmca`, `/legal/2257`, `/legal/refund`), Company (`/legal/about`, `/legal/contact`), and Social (placeholder external hrefs, `rel="noopener noreferrer"`, `target="_blank"`, each marked `// PLACEHOLDER: real social URL`). A clear "18+" mark and a one-line company/copyright string using the current year. Give the footer `data-testid="site-footer"`. Every legal link points at a `/legal/*` route that Phase 15 provides; keep the exact slugs above so the two phases line up.

## Test instructions
```
# E2E (Playwright): from repo root, dev server auto-starts (playwright.config.ts webServer)
npm run test:e2e -- marketing        # add e2e/marketing.spec.ts covering:
# - GET / returns 200 and renders the hero headline + both CTAs
# - "Create your companion" links to /signup; "Browse" links to /gallery (assert hrefs)
# - at least one [data-testid="persona-preview"] renders when the local DB has public characters (seed first if needed)
# - a mature preview is gated (blurred / "18+ verify") for an unauthenticated visitor (no clear mature image on /)
# - the footer [data-testid="site-footer"] renders and its legal links resolve (status < 400) OR are present as hrefs when Phase 15 has not shipped
# - logged-in users see a Dashboard link in the header; visitors see Log in + Sign up

# Manual
npm run db:seed        # LOCAL only, so the hero has real characters to show
npm run dev:frontend   # open http://localhost:3000 and eyeball the hero carousel + footer
```

## Sanity checklist
- [ ] `/` is a server component, renders in under a second, and never 500s when the DB is empty or unreachable (degrades to placeholder tiles).
- [ ] Hero previews are REAL public characters from `listCharacters` (not hardcoded), sorted by popularity, and each links to its `/characters/:id` detail page.
- [ ] Mature previews are blurred/gated for unauthenticated visitors exactly like the gallery card; no clear mature imagery leaks onto the public landing.
- [ ] CTAs route correctly: "Create your companion" -> `/signup`, "Browse" -> `/gallery`.
- [ ] Public header shows Log in + Sign up for visitors and a Dashboard link for logged-in users; the logo links home.
- [ ] `Footer` is mounted site-wide on the `(public)` shell and links all legal pages + socials + an 18+ mark + company line.
- [ ] No regression: `/gallery`, `/characters/:id`, and the existing header links still work; the characters read path (`listCharacters`, `getViewer`) is unchanged.
- [ ] Carousel is keyboard accessible (arrow keys, focus-visible) and pauses on hover; no external carousel/icon libraries fetched at runtime.
- [ ] No em dashes in the diff.

## Done criteria
A visitor landing on `/` sees a real marketing home page: an animated hero with live companion previews, value props, social proof, and working CTAs, wrapped in an upgraded public header (Log in / Sign up, Dashboard when authed) and a site-wide footer that links every legal page. Nothing in the existing public gallery or character-detail flow regresses, and the page renders safely even with an empty database. All Playwright checks above pass locally.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy, or migration against a non-local database. `npm run db:seed` / `npm run db:migrate` are allowed ONLY against your LOCAL Postgres. Local unit/E2E tests and dev servers are fine. When unsure whether an action is prod-touching, assume it is and ask first.
