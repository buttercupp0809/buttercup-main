# Phase 17: Dark app shell, left side nav, dashboard, logout, relationship UI

## Goal
Turn the bare top-nav-only in-app shell into a persistent, Candy/Nastia-style **left side-nav app shell** on a **dark cinematic theme**. Rebuild `frontend/app/(protected)/layout.tsx` so every authenticated surface renders a fixed left sidebar (Chats, Discover, Create, Settings) plus a **bottom profile menu** (avatar, name, plan/tier badge, Profile, Billing, Log out). The sidebar collapses to a mobile drawer plus bottom bar. Introduce dark theme tokens (near-black base, rose/skin accent, violet secondary) and a distinctive display + body font pairing, applied only to the in-app shell (marketing keeps the lighter public shell). Wire the existing `/api/auth/logout` route to the Log out button (and add a logout control to Settings). Enhance the dashboard with Continue / New / Trending / For you rows and a prominent Create CTA. Add a reusable **relationship/affection indicator** driven by `RelationshipState` (affectionLevel, mood, milestones), shown in the chat header and optionally on cards.

This is a **visual + navigation layer** over existing routes and data. Routing, API, and data contracts are unchanged. Covers PRD (experience-monetization) §2.3 and §1 (design direction).

## Prerequisites
- Phases 00 to 16 green. In particular:
  - `frontend/app/(protected)/layout.tsx` exists and is **top-nav only** (renders `Poppy` label + `<AiDisclosure />`, wraps `requireAgeVerified()`). This is what you rebuild.
  - `frontend/app/(protected)/dashboard/page.tsx` exists (Continue rail + Popular/New sections via `getDashboardFeed()` and `CharacterCard`). You enhance it, do not remove it.
  - `frontend/app/api/auth/logout/route.ts` exists (POST, `clearAuthCookie`, returns `jsonOk()`) but is not linked from any UI.
  - `frontend/app/(protected)/settings/page.tsx` + `SettingsClient.tsx` exist (read-only profile, password change, export, delete).
  - `frontend/app/(protected)/create/` wizard (5 steps) exists and must remain intact.
  - `frontend/components/ai-disclosure.tsx` exists (`variant="pill"|"banner"`, `data-testid="ai-disclosure"`).
  - `frontend/components/chat/ChatWindow.tsx` + `frontend/app/(protected)/chat/[characterId]/page.tsx` exist (chat header is currently just `characterName`).
  - `RelationshipState` model exists in `packages/database/prisma/schema.prisma` (fields: `userId`, `characterId`, `affectionLevel Int @default(0)`, `milestones String[]`, `mood String?`, unique on `[userId, characterId]`) with **zero UI**.
  - `frontend/lib/auth.ts` (`requireAgeVerified`, `getCurrentUser`, `requireAuth`), `frontend/lib/viewer.ts` (`getViewer`), `frontend/lib/feed.ts` (`getDashboardFeed`) exist.
- Playwright runs from the repo root `e2e/` dir (`testDir: "e2e"`, baseURL `http://localhost:3000`), started with `npm run test:e2e` (see `playwright.config.ts`). Existing seeded system characters and a seeded verified test user are available (used by `e2e/gallery.spec.ts` + `e2e/auth-age-gate.spec.ts`).

## Context to paste into Cursor
Paste this block at the top of the Cursor agent session:

> Building Poppy Phase 17 (dark app shell + left side nav + dashboard + logout + relationship UI). Read `prds/experience-monetization-prd.md` §2.3 and §1 first. This is additive and non-regressive: every existing protected route must stay reachable, the AI-disclosure pill must stay visible on every authenticated surface (SB 243), and the create wizard + settings behavior must be unchanged.
>
> Conventions: Next.js 16 App Router, server components by default, `"use client"` only where interactivity is required. Prisma singleton `import { prisma } from "@poppy/database"` (never `new PrismaClient()`). Tailwind 4 with design tokens as CSS vars in `frontend/app/globals.css`. TypeScript strict. Reuse `cn()` from `frontend/lib/utils`. No em dashes anywhere (use commas, periods, parentheses).
>
> Design direction (PRD §1): the in-app shell is dark and cinematic, image-forward, sensual-but-refined. Dark base near-black, warm rose/skin accent, soft violet secondary, high-contrast white text. The marketing/public shell stays lighter and is untouched. Add a distinctive display + body font pairing (do not ship Inter-only).
>
> Data: `RelationshipState` (affectionLevel 0..100 style int, mood string, milestones string[]) exists in Prisma with no UI. Surface it read-only in the chat header (and optionally on cards). Do not add write logic here.

**Chosen theme and fonts (use these exact values so the design is deterministic):**
- Accent (rose/skin): `--poppy-accent-rose: 344 84% 71%` (approx `#FF6B8A`), soft variant `348 62% 77%` (approx `#E8A0BF`).
- Secondary (violet): `--poppy-accent-violet: 262 72% 68%`.
- App dark base: `--poppy-app-bg: 240 20% 5%` (approx `#0B0B0F`), raised surface `240 14% 9%`, border `240 10% 18%`, text `0 0% 98%`, muted text `240 6% 65%`.
- **Font pairing:** display face **Fraunces** (a warm high-contrast humanist serif with optical sizing, for headings and the wordmark) paired with body **Geist Sans** (a clean characterful grotesque, for UI and body). Both are available via `next/font/google`. This is intentionally not generic Inter-only.

## Build steps
Do these in order. Name files exactly as below.

1. **Dark app theme tokens** in `frontend/app/globals.css`
   - Keep the existing `:root` sky tokens for the public/marketing shell. Add a **scoped** dark app theme under a `.poppy-app` class (do NOT flip global `:root` to dark, so marketing stays light). Define, on `.poppy-app`:
     - `--poppy-bg: 240 20% 5%;` `--poppy-surface: 240 14% 9%;` `--poppy-surface-2: 240 12% 13%;`
     - `--poppy-fg: 0 0% 98%;` `--poppy-muted: 240 6% 65%;` `--poppy-border: 240 10% 18%;`
     - `--poppy-accent-rose: 344 84% 71%;` `--poppy-accent-rose-soft: 348 62% 77%;` `--poppy-accent-violet: 262 72% 68%;`
     - `--poppy-primary: var(--poppy-accent-rose);` `--poppy-primary-fg: 240 20% 5%;`
   - Add a small set of utility helpers (comment them): `.poppy-app` sets `background-color: hsl(var(--poppy-bg)); color: hsl(var(--poppy-fg));`, and a `.poppy-scrim` gradient utility (`linear-gradient(to top, hsl(var(--poppy-bg)/0.95), transparent)`) reused by cards later.
   - Ensure contrast: muted text on surface must clear WCAG AA (4.5:1 for body). Note the check in a comment.

2. **Fonts** in `frontend/app/layout.tsx` (root)
   - Import `Fraunces` and `Geist` (or `Geist_Sans`) from `next/font/google`, expose them as CSS variables `--font-display` and `--font-body` on `<html>` (via `className`). Do not force dark on `<body>`; the app shell opts in via `.poppy-app`.
   - In `globals.css`, map Tailwind font utilities: body defaults to `var(--font-body)`, add a `.font-display { font-family: var(--font-display); }` for headings and the wordmark. Marketing pages continue to use the body sans; only the app wordmark/headings use display.

3. **Sidebar nav config** `frontend/components/app-shell/nav-items.ts`
   - Export `APP_NAV: { href: string; label: string; icon: string; testid: string }[]` = Chats (`/chats`), Discover (`/gallery`), Create (`/create`), Settings (`/settings`). Use existing routes: **Discover maps to `/gallery`** (the in-app discover reuses the gallery route, upgraded in Phase 18), **Create maps to `/create`**, **Settings to `/settings`**. Chats maps to a new `/chats` index (step 6). Keep `icon` as a small inline SVG name or lucide-react icon key if `lucide-react` is already a dep (check `package.json`; if not present, inline minimal SVGs, do not add a dependency without asking).

4. **Sidebar component** `frontend/components/app-shell/SideNav.tsx` (client)
   - Renders the vertical rail: wordmark `Poppy` in `.font-display` at top, then `APP_NAV` links with active-state styling (`usePathname()` to mark the active item with a rose left-accent bar + `aria-current="page"`). Each link has `data-testid={item.testid}` (e.g. `nav-chats`, `nav-discover`, `nav-create`, `nav-settings`).
   - Below the primary nav, render a **Recent conversations** list (props: `recents: { characterId, characterName, avatarUrl }[]`) as compact rows linking to `/chat/{characterId}`. Cap at 6, with a "See all" link to `/chats`.
   - Keyboard nav: links are real `<a>`/`<Link>`, focus-visible ring in rose, `aria-label="Primary"` on the `<nav>`.
   - Collapsible: accept `collapsed` state (icon-only rail) toggled by a button; persist preference in `localStorage` (`poppy.sidenav.collapsed`). Collapsed rail still shows tooltips (title attr) and the profile avatar.

5. **Profile menu** `frontend/components/app-shell/ProfileMenu.tsx` (client)
   - Bottom-of-sidebar button: avatar (initial fallback), display name/email, and a **plan/tier badge** (props: `tier: string`, e.g. `free|daily|weekly|monthly` or legacy `free|premium|pro`). Badge styled with rose/violet by tier.
   - On click, opens a small popover with: **Profile** (link to `/settings`), **Billing** (link to `/billing` if that route exists; otherwise `/settings`, leave a `TODO` comment), and **Log out**.
   - **Log out button** posts to `/api/auth/logout`:
     ```ts
     await fetch("/api/auth/logout", { method: "POST" });
     window.location.assign("/"); // hard nav so server re-reads the cleared cookie
     ```
     Give it `data-testid="logout-button"`. Disable while the request is in flight; on failure show an inline error and do not redirect.

6. **Chats index route** `frontend/app/(protected)/chats/page.tsx` (server)
   - Guarded by the protected layout. Server-fetch the user's conversations (reuse the `loadRecents` pattern from `frontend/lib/feed.ts`, or add a `listConversations(userId)` helper in `frontend/lib/chats.ts` returning `{ characterId, characterName, avatarUrl, lastMessageAt, messageCount, relationship? }`). Render a list linking each row to `/chat/{characterId}`. Empty state: a friendly card with a Discover CTA to `/gallery`. This backs the sidebar "Chats" item and its "See all".

7. **Rebuild the app shell** `frontend/app/(protected)/layout.tsx` (server)
   - Keep `await requireAgeVerified()` (age gate must not regress). Fetch the current user (`getCurrentUser()`), their subscription tier, and top 6 recents (`listConversations` or the feed recents helper) server-side to hydrate the sidebar and profile menu.
   - Structure:
     ```tsx
     <div className="poppy-app flex min-h-screen">
       <SideNav recents={...} user={...} />           {/* fixed left rail, hidden on mobile */}
       <div className="flex min-h-screen flex-1 flex-col">
         <header className="... flex items-center justify-between ...">
           <MobileNavTrigger /> {/* hamburger, mobile only */}
           <AiDisclosure />     {/* SB 243, MUST stay visible on every surface */}
         </header>
         <main className="flex-1">{children}</main>
         <MobileBottomBar />    {/* mobile only: Chats / Discover / Create / Profile */}
       </div>
     </div>
     ```
   - The `.poppy-app` wrapper scopes the dark theme so only in-app surfaces go dark.
   - Keep `<AiDisclosure />` mounted in the header exactly as before (same `data-testid="ai-disclosure"`), so SB 243 disclosure never disappears.

8. **Mobile drawer + bottom bar** `frontend/components/app-shell/MobileNav.tsx` (client)
   - `MobileNavTrigger` (hamburger) opens a slide-in `Drawer` containing the same `APP_NAV` + recents + profile actions. Close on route change and on Escape; trap focus while open; backdrop click closes. `data-testid="mobile-nav-trigger"` and `data-testid="mobile-nav-drawer"`.
   - `MobileBottomBar`: fixed bottom bar with 4 tappable items (Chats, Discover, Create, Profile), shown only under `md`. Active item highlighted in rose.
   - The desktop `SideNav` is `hidden md:flex`; the bottom bar is `flex md:hidden`.

9. **Relationship / affection indicator** `frontend/components/relationship/AffectionMeter.tsx`
   - Props: `{ affectionLevel: number; mood?: string | null; milestones?: string[]; size?: "sm" | "md"; showLabel?: boolean }`.
   - Render a compact meter: a heart or bar filled proportional to `affectionLevel` (treat scale as 0..100; clamp), a mood chip (e.g. `mood` capitalized) when present, and a tooltip listing the latest milestone. Rose fill on the dark surface. `data-testid="affection-meter"`, `aria-label={`Affection ${clampedPercent}%`}` for screen readers. Pure presentational, no data fetch.
   - Add `frontend/lib/relationship.ts` with `getRelationship(userId, characterId)` returning `{ affectionLevel, mood, milestones } | null` via `prisma.relationshipState.findUnique({ where: { userId_characterId: { userId, characterId } } })`. Return `null` (not throw) when absent.

10. **Wire relationship into the chat header** `frontend/components/chat/ChatWindow.tsx` + `frontend/app/(protected)/chat/[characterId]/page.tsx`
    - In the chat page (server), fetch `getRelationship(user.id, characterId)` and pass it plus the character avatar into `ChatWindow` as new optional props (`relationship?`, `avatarUrl?`). Do not change the existing `conversationId` / `initialMessages` / `characterName` / `wsUrl` props or transport behavior.
    - In `ChatWindow`, add a header row above the message list: character avatar + `characterName` (in `.font-display`) + `<AffectionMeter size="sm" ... />` when `relationship` is present. Keep everything else (streaming, safety banner, typing) untouched. If `relationship` is undefined, render just avatar + name (no meter).

11. **Optional: relationship dot on cards** `frontend/components/gallery/CharacterCard.tsx`
    - Accept an optional `relationship?: { affectionLevel: number; mood?: string | null }` prop (default undefined). When present, render a tiny mood/online dot on the card image (rose if affection > 0). Do NOT change existing card behavior when the prop is absent (dashboard/gallery pass nothing unless they have the data). Keep mature blur logic exactly as is.

12. **Enhance the dashboard** `frontend/app/(protected)/dashboard/page.tsx` + `frontend/lib/feed.ts`
    - Extend `getDashboardFeed(viewer)` to also return a **Trending** section and a **For you** section:
      - `Trending`: `listCharacters({ sort: "trending", limit: 8 }, viewer)`.
      - `For you`: reuse `popular` (or a tag-affinity query if cheap); label it "For you" and add a `TODO` for personalization. Keep `Popular` and `New this week`.
    - In the page, keep the existing "Continue chatting" recents rail (it already links to `/chat/{id}`). Restyle rows for the dark theme (surface cards, rose hover). Add a **prominent Create CTA** block near the top (`Link` to `/create`, `.font-display` heading, rose gradient button) that stands out.
    - Render sections in order: Continue, Create CTA, For you, New this week, Trending, Popular (or a sensible order). Reuse `CharacterCard`. Do not remove any existing section.

13. **Regression sweep of protected surfaces**
    - Confirm `/dashboard`, `/gallery`, `/create`, `/settings`, `/chat/[characterId]`, `/chats` all render inside the new shell with the sidebar and the AI-disclosure pill. The create wizard steps and settings actions must be visually reskinned by the dark `.poppy-app` wrapper but functionally unchanged.
    - Add a **Log out** control to Settings too: in `SettingsClient.tsx` add a "Log out" button (reusing the same POST + hard nav to `/`), `data-testid="settings-logout"`. This satisfies the PRD requirement that logout is reachable from both the profile menu and settings.

## Test instructions
- **Playwright (E2E):** `e2e/app-shell.spec.ts` (new). Log in as the seeded verified user (mirror the login helper used in `e2e/auth-age-gate.spec.ts`), then:
  - Sidebar renders on `/dashboard`; clicking `nav-discover` routes to `/gallery`, `nav-create` to `/create`, `nav-settings` to `/settings`, and a recent conversation row (or `nav-chats` then a row) routes to `/chat/...`.
  - `data-testid="ai-disclosure"` is visible on `/dashboard`, `/gallery`, `/create`, `/settings`, and `/chat/...` (assert on each).
  - Dashboard renders the Continue rail (when recents exist) and the Create CTA plus feed sections (assert section headings For you / New this week / Trending / Popular are present).
  - Logout: click `logout-button` in the profile menu; assert the browser lands on `/` (landing) and that navigating back to `/dashboard` redirects to login (cookie cleared). Repeat the assertion for `settings-logout`.
  - Mobile: set a mobile viewport, open `mobile-nav-trigger`, assert `mobile-nav-drawer` is visible and a nav link inside it routes correctly; assert the desktop `SideNav` is hidden at that width.
  - Run: `npm run test:e2e -- app-shell`.
- **Playwright (regression):** re-run `e2e/gallery.spec.ts` and `e2e/auth-age-gate.spec.ts` to confirm no regressions. Run: `npm run test:e2e`.
- **Vitest (unit, pure):** `frontend/components/relationship/__tests__/affection.test.ts` (or colocated) asserting `AffectionMeter` clamps `affectionLevel` to 0..100 and computes the fill percent correctly (extract the clamp/percent math into a tiny pure helper so it is testable without rendering). Run: `npm run test -w frontend -- affection`.
- **Manual:** `npm run dev`, sign in, confirm the app is dark and cinematic (rose accent, Fraunces headings), the sidebar collapses, the profile menu logs you out, the chat header shows the affection meter for a character you have a `RelationshipState` row for, and the marketing landing (`/`) is still the lighter public shell.

## Sanity checklist
- [ ] `(protected)/layout.tsx` renders a persistent left sidebar (Chats, Discover, Create, Settings) plus a bottom profile menu (avatar, name, tier badge, Profile, Billing, Log out) on every authenticated route.
- [ ] The dark cinematic theme applies ONLY inside `.poppy-app` (in-app surfaces); the public/marketing shell is unchanged and still light.
- [ ] The AI-disclosure pill (`data-testid="ai-disclosure"`) is visible on every protected surface (dashboard, gallery, create, settings, chat). SB 243 not regressed.
- [ ] Log out from the profile menu AND from settings both hit `/api/auth/logout`, clear the cookie, and redirect to `/`; a subsequent visit to `/dashboard` redirects to login.
- [ ] Dashboard shows Continue (when recents exist), a prominent Create CTA, and For you / New this week / Trending / Popular feeds; no existing section removed.
- [ ] `AffectionMeter` renders in the chat header when a `RelationshipState` row exists, is accessible (aria-label, clamped value), and is absent (gracefully) when there is no row.
- [ ] Mobile: sidebar collapses to a drawer (`mobile-nav-trigger` opens `mobile-nav-drawer`) plus a bottom bar; desktop sidebar is hidden under `md`.
- [ ] Create wizard steps and settings actions (password, export, delete) still work exactly as before, just reskinned.
- [ ] Dark theme meets WCAG AA contrast for body and muted text; sidebar links are keyboard navigable with a visible focus ring.

## Done criteria
"Green" = the `app-shell` Playwright spec passes, `gallery` and `auth-age-gate` specs still pass, the affection unit test passes, every protected route renders inside the dark side-nav shell with the AI-disclosure pill visible, logout works from both entry points, the dashboard shows the enhanced feeds plus Create CTA, and the relationship indicator surfaces in the chat header. The marketing landing is untouched and remains light. No chat/monetization/prompt behavior beyond the visual + nav layer is changed here.

## Guardrail note
Do not commit, push, run a non-local migration, or deploy as part of this phase. No schema change is required here (`RelationshipState` already exists); if any Prisma tweak ever seems needed, generate the migration locally only and STOP to ask for explicit human approval before applying it anywhere non-local. Every commit, push, deploy, or non-local DB change requires a fresh, explicit, per-action human approval.
