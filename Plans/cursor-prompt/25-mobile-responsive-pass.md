# Phase 25: Mobile Responsive Pass

## Goal
Audit and harden the mobile/tablet experience across the four user-facing
surfaces without a rewrite. The app is already mobile-first Tailwind (the shell
ships a `MobileNav` drawer + `MobileBottomBar`, reels/marketing carousels
already scroll-snap), so this phase closes the remaining gaps rather than
rebuilding: (1) the marketing/landing site, (2) the app shell + sidenav +
dashboard, (3) the chat 3-pane experience, (4) the scroll/feed surfaces
(gallery grid, dashboard recent-chats strip, reels). Concretely it: adds
safe-area-inset padding for notch/home-bar (nothing uses `env(safe-area-inset-*)`
today), promotes the chat `ChatList` and `PersonaPanel` from plain `hidden`
(no mobile access at all today) to reachable slide-over / bottom-sheet drawers,
makes the single-line chat composer keyboard-safe and sticky above the mobile
keyboard, enforces 44px minimum touch targets on nav/action controls that are
currently `h-7`/`h-9`/`p-1`, fills the tablet `md` gap (the grids jump
`sm` -> `lg` with nothing tuned for `md`, and `ChatList` first appears at `lg`
with no `md` state), and normalizes horizontal-scroll feeds with snap + momentum
and image aspect-ratio consistency. The dark cinematic theme and every design
token stay exactly as-is. Frontend `.tsx` / `.css` only: no schema, no API, no
new data.

Reference: PRD §2.3 (in-app shell), §1 (dark cinematic theme + tokens),
`frontend/app/globals.css` (`--buttercupp-*` tokens, `.buttercupp-glass`,
`.buttercupp-scrim`). Web-first responsive PWA is a locked decision (README
ground rules).

## Prerequisites
- Phase green shell + nav: `frontend/app/(protected)/layout.tsx` (the
  `h-screen overflow-hidden` shell with `<SideNav>`, `<MobileNav>`,
  `<MobileBottomBar>`, `<main className="... pb-16 md:pb-0">`),
  `frontend/components/app-shell/SideNav.tsx` (`hidden ... md:flex`,
  collapse toggle, `STORAGE_KEY`), `frontend/components/app-shell/MobileNav.tsx`
  (`MobileNav` drawer `md:hidden` + `MobileBottomBar` `fixed inset-x-0 bottom-0`),
  `frontend/components/app-shell/nav-items.ts` (`APP_NAV`).
- Chat 3-pane green: `frontend/app/(protected)/chat/[characterId]/page.tsx`
  (`flex h-full overflow-hidden` with `ChatList`, `ChatWindow` in `flex-1`,
  `PersonaPanel`), `frontend/components/chat/ChatList.tsx`
  (`hidden ... w-80 ... lg:flex`), `frontend/components/chat/PersonaPanel.tsx`
  (`hidden ... w-96 ... xl:flex`), `frontend/components/chat/ChatWindow.tsx`
  (single-line `<input data-testid="chat-input">` in a `<form>`, `data-testid`
  `chat-send`, `bubble-user`, `bubble-assistant`).
- Feeds green: `frontend/app/(protected)/dashboard/page.tsx` (recents strip
  `flex gap-4 overflow-x-auto`, grids `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`),
  `frontend/components/gallery/CharacterGrid.tsx` +
  `frontend/components/gallery/CharacterCard.tsx` (`aspect-[9/16]` cards),
  `frontend/components/reels/ReelScroller.tsx` (`snap-y snap-mandatory
  overflow-y-scroll overscroll-contain`), `frontend/components/marketing/*`
  (`Hero.tsx`, `ReelsCarousel.tsx`, `ValueProps.tsx`, `SocialProof.tsx`),
  `frontend/app/(public)/page.tsx`.
- Playwright green: `playwright.config.ts` (baseURL `http://localhost:3000`,
  single `chromium` project today), existing device/gesture specs in `e2e/`
  (`marketing.spec.ts`, `gallery.spec.ts`, `app-shell.spec.ts`,
  `chat-gestures.spec.ts`) and the seeded-cookie gating pattern
  (`E2E_SEEDED`, `E2E_VERIFIED_COOKIE`, `E2E_CHARACTER_ID`).

## Context to paste into Cursor
```
You are implementing Phase 25 of ButterCupp (see prds/master-prd.md §2.3, §1).

This is an AUDIT + HARDEN pass on an already mobile-first Tailwind app, NOT a
rewrite. Do NOT change the dark cinematic theme, the --buttercupp-* design
tokens, .buttercupp-glass, or .buttercupp-scrim. Keep server-centric Next.js 16
App Router; add client state only where a drawer/sheet genuinely needs it.
TypeScript strict, no `any`. No em dashes anywhere.

FOUR SURFACES to cover:
  1. Marketing/landing:  frontend/app/(public)/page.tsx + frontend/components/marketing/*
  2. App shell + nav + dashboard:
        frontend/app/(protected)/layout.tsx
        frontend/components/app-shell/{SideNav,MobileNav,nav-items}.tsx
        frontend/app/(protected)/dashboard/page.tsx
  3. Chat 3-pane:
        frontend/app/(protected)/chat/[characterId]/page.tsx
        frontend/components/chat/{ChatList,PersonaPanel,ChatWindow}.tsx
  4. Scroll/feeds:
        frontend/components/gallery/{CharacterGrid,CharacterCard}.tsx
        frontend/app/(protected)/dashboard/page.tsx (recents strip)
        frontend/components/reels/ReelScroller.tsx
        frontend/components/marketing/ReelsCarousel.tsx

TARGET BREAKPOINTS (Tailwind defaults): base < 640, sm 640, md 768, lg 1024,
xl 1280. The known gap is md (tablet): grids jump sm -> lg and ChatList first
appears at lg, so tune the md column of the matrix explicitly.

DEVICE MATRIX to satisfy (portrait unless noted):
  iPhone SE   375 x 667   (smallest, notch-less, tight)
  iPhone 14   390 x 844   (notch + home-bar safe areas)
  Pixel 7     412 x 915   (Android, gesture bar)
  iPad mini   744 x 1133  (md tablet, portrait)
  iPad Pro    1024 x 1366 (lg, landscape jumps to xl)

WHAT ALREADY EXISTS (do not duplicate, extend/harden):
  - MobileNav (left drawer, md:hidden) + MobileBottomBar (fixed bottom, md:hidden)
    are wired in the protected layout. Harden focus-trap + touch targets + safe area.
  - ReelScroller + marketing ReelsCarousel already use scroll-snap. Add momentum,
    overscroll-contain where missing, and safe-area bottom padding.

WHAT IS MISSING (the real work):
  - Zero safe-area-inset support anywhere. Add env(safe-area-inset-*) utilities
    and apply to the bottom bar, chat composer, reels controls, and drawers.
  - ChatList (hidden lg:flex) and PersonaPanel (hidden xl:flex) are UNREACHABLE
    on mobile/tablet. Add drawer/bottom-sheet access on smaller widths.
  - Chat composer is a single-line <input> that is not keyboard-safe and not
    pinned above the on-screen keyboard.
  - Several controls are below 44px (SideNav toggle p-1, MobileNav trigger p-2,
    ChatWindow send h-9 w-9, ChatList action h-7 w-7, bottom-bar links py-2).
  - md/tablet column of the grids and the chat panes is untuned.

Add <meta name="viewport" ... viewport-fit=cover> so env(safe-area-inset-*)
resolves. Guard interactive drawers behind describe.skipIf where a DB session
cookie is needed (reuse E2E_SEEDED / E2E_VERIFIED_COOKIE / E2E_CHARACTER_ID).
```

## Build steps

Work surface by surface. Every class you add is additive on top of the existing
mobile-first classes; do not delete a working desktop class to fix mobile.

### 0. Global primitives (shared by all four surfaces)

1. **Viewport + safe area meta: `frontend/app/layout.tsx`**
   - Ensure the Next 16 `viewport` export sets `viewportFit: "cover"` (or a
     `<meta name="viewport" content="width=device-width, initial-scale=1,
     viewport-fit=cover">`) so `env(safe-area-inset-*)` resolves on notched
     devices. Without this every safe-area utility below is a no-op.
   - Do NOT change theme color, font loading, or the `dark` class on `<html>`.

2. **Safe-area + touch utilities: `frontend/app/globals.css`**
   - Add small, token-free utility classes (keep them as plain CSS, not new
     tokens):
     ```css
     /* Notch / home-bar safe areas. No-ops on devices without insets. */
     .pb-safe   { padding-bottom: max(env(safe-area-inset-bottom), 0px); }
     .pt-safe   { padding-top: max(env(safe-area-inset-top), 0px); }
     .px-safe   { padding-left: max(env(safe-area-inset-left), 0px);
                  padding-right: max(env(safe-area-inset-right), 0px); }
     /* Minimum comfortable tap target (WCAG 2.5.5 / Apple HIG). */
     .tap-target { min-height: 44px; min-width: 44px; }
     ```
   - Add a full-dynamic-height helper for keyboard/URL-bar resilience:
     ```css
     .h-dvh { height: 100dvh; }   /* falls back to vh where unsupported */
     ```
   - Do NOT alter existing `.buttercupp-glass`, `.buttercupp-scrim`, or any
     `--buttercupp-*` token.

### 1. Surface A: marketing / landing

3. **Landing container + CTA sizing: `frontend/app/(public)/page.tsx`**
   - The final CTA buttons use `px-6 py-6 text-base` inside `flex-wrap`; confirm
     they are already >= 44px tall (they are) and add `w-full sm:w-auto` so each
     button is full-width and thumb-reachable on `iPhone SE` before splitting to
     a row at `sm`.
   - Add `px-safe` to the outer sections so text never sits under a landscape
     notch.

4. **Hero responsiveness: `frontend/components/marketing/Hero.tsx`**
   - The heading already scales `text-4xl sm:text-5xl md:text-6xl`; leave it.
   - The 3-up slide strip must not overflow the body on narrow widths: ensure the
     strip container is `overflow-x-hidden` (slides are chunked by 3 for desktop)
     and that each `PersonaPreviewCard` uses `w-full` inside a
     `grid-cols-1 sm:grid-cols-2 md:grid-cols-3` grid so `md` (tablet) shows 2-3
     without a horizontal scrollbar. Do not change the auto-advance logic.

5. **Marketing reels carousel: `frontend/components/marketing/ReelsCarousel.tsx`**
   - Confirm the horizontal rail has `snap-x snap-mandatory overflow-x-auto` and
     add `[-webkit-overflow-scrolling:touch]` (momentum) + `snap-start` on each
     tile + `px-safe` so the first/last tile is not clipped by the notch in
     landscape. No behavioral change.

### 2. Surface B: app shell + sidenav + dashboard

6. **Shell safe areas + keyboard-safe main: `frontend/app/(protected)/layout.tsx`**
   - The shell is `flex h-screen overflow-hidden`. Change `h-screen` to
     `h-dvh` (dynamic viewport height) so the mobile URL bar / keyboard collapse
     does not crop the bottom bar. Keep `overflow-hidden`.
   - `<header>`: add `pt-safe` so the top row clears the notch.
   - `<main>` currently `pb-16 md:pb-0`: keep it, but make the reserve
     safe-area-aware -> `pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0` so
     content is not hidden behind the bottom bar on home-bar devices.

7. **Bottom bar touch + safe area: `frontend/components/app-shell/MobileNav.tsx`
   (`MobileBottomBar`)**
   - The bar is `fixed inset-x-0 bottom-0 ... md:hidden`. Add `pb-safe` so the
     tab row sits above the home indicator, and give each tab link `tap-target`
     + `min-h-[44px]` (currently `py-2` yields ~36px). Keep the 5-item layout and
     the active rose color.

8. **Drawer hardening: `frontend/components/app-shell/MobileNav.tsx` (`MobileNav`)**
   - The drawer already opens, closes on route change + Escape, locks body
     scroll, and focuses the first link. Add a real focus trap (cycle Tab within
     the drawer) and `pt-safe`/`pb-safe` on the drawer `<aside>`.
   - Bump the trigger (`p-2`, ~36px) and the close button (`p-1`) to
     `tap-target`. Keep `data-testid="mobile-nav-trigger"` and
     `data-testid="mobile-nav-drawer"`.

9. **SideNav toggle target: `frontend/components/app-shell/SideNav.tsx`**
   - The collapse toggle is `p-1`. Add `tap-target` (it only shows at `md+`, but
     iPad touch still needs 44px). No change to the collapse/localStorage logic
     or the `hidden md:flex` visibility.

10. **Dashboard grid md tuning + recents strip:
    `frontend/app/(protected)/dashboard/page.tsx`**
    - Feed grids are `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. Add the missing
      `md` step -> `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4`
      (explicit `md` so tablet is intentional, not inherited from `sm`).
    - Recents strip is `flex gap-4 overflow-x-auto pb-2`. Add
      `snap-x snap-mandatory [-webkit-overflow-scrolling:touch] px-safe` and
      `snap-start` on each recent `<Link>` so the strip flicks with momentum and
      settles on a card. Keep `w-40 shrink-0`.
    - Outer `<section>` `px-6`: leave, but add `px-safe` so cards clear a
      landscape notch.

### 3. Surface C: chat 3-pane

11. **Chat page: make the two side panes reachable on mobile/tablet:
    `frontend/app/(protected)/chat/[characterId]/page.tsx`**
    - Today: `ChatList` (`hidden lg:flex`) and `PersonaPanel` (`hidden xl:flex`)
      are simply not present below their breakpoint, so a phone user cannot open
      the conversation list or the persona gallery at all.
    - Keep the server component fetching exactly as-is (it already computes
      `conversations`, `carouselImages`, `imageBlurs`, `assets`). Pass the same
      props into two NEW client sheet wrappers so mobile gets drawer access
      without duplicating the desktop layout:
      - Render `ChatList` inside a new `PanelSheet` (step 12) that is a left
        slide-over below `lg`, and inline (its current `hidden lg:flex` aside)
        at `lg+`.
      - Render `PersonaPanel` inside a `PanelSheet` that is a right bottom-sheet
        (or right slide-over) below `xl`, and inline at `xl+`.
    - Add a compact chat top-bar affordance (step 13) that exposes the two
      triggers plus a Back control on mobile. Do not change any data fetching or
      the mature-gate / notFound logic.

12. **New component `frontend/components/chat/PanelSheet.tsx`** (client, small,
    reusable)
    - Props: `{ side: "left" | "right" | "bottom"; open: boolean; onClose():
      void; label: string; children: React.ReactNode }`.
    - Renders a `fixed inset-0 z-50` scrim (`bg-black/70 backdrop-blur`) + a
      panel that slides from `side`. Left/right panels: `inset-y-0`, `w-[86vw]
      max-w-sm`, `h-dvh`, `pt-safe pb-safe`. Bottom sheet: `inset-x-0 bottom-0`,
      `max-h-[85dvh]`, rounded top, `pb-safe`, with a drag-handle bar.
    - Behavior mirrors the existing `MobileNav` drawer contract: close on
      Escape, close on scrim click, lock `document.body` scroll while open,
      focus-trap, `role="dialog" aria-modal="true" aria-label={label}`.
    - Style with existing tokens only (`hsl(var(--buttercupp-bg))`,
      `--buttercupp-border`). No new tokens. `data-testid="panel-sheet"`.

13. **ChatList mobile access: `frontend/components/chat/ChatList.tsx`**
    - Keep the existing `<aside className="hidden ... lg:flex">` exactly for the
      inline desktop column.
    - Extract the inner content (header + search + list) so the SAME markup can
      render inside a `PanelSheet` on mobile (avoid duplicating the row/menu
      logic). Give the conversation-actions button (`h-7 w-7`) a larger hit area
      on touch via `tap-target` while keeping the small visual glyph, and make
      the action menu open on tap (it already toggles on click).
    - Add `data-testid="chatlist-trigger"` to the mobile trigger surfaced in the
      chat top-bar.

14. **PersonaPanel mobile access: `frontend/components/chat/PersonaPanel.tsx`**
    - Keep the existing `<aside className="hidden ... xl:flex">` for `xl+`.
    - Extract the panel body (primary image + name/description + gallery grid +
      private-content CTA) so it can also render inside the right/bottom
      `PanelSheet` below `xl`. The gallery grid stays `grid-cols-3` but each tile
      must keep `aspect-ratio: 9/16` (already set) so images stay consistent in
      the narrower sheet. Locked-tile blur/paywall logic is unchanged.
    - Add `data-testid="persona-trigger"` to the mobile trigger.

15. **Keyboard-safe, sticky composer + 44px targets:
    `frontend/components/chat/ChatWindow.tsx`**
    - The composer `<form>` is currently a normal flow child. On mobile it must
      stay pinned above the on-screen keyboard: make the outer chat container
      `h-dvh` (so it tracks the visual viewport) and give the `<form>`
      `sticky bottom-0 pb-safe` with the surface background, so it rides above
      the keyboard and clears the home bar. Keep the desktop look identical at
      `md+`.
    - The send button is `h-9 w-9` (~36px): add `tap-target`. The `SceneButton`
      row (`py-1` pills) gets `min-h-[36px]` on mobile and wraps
      (`flex-wrap`) so Image/Video/Settings never overflow the `iPhone SE` width.
    - The message list is `flex-1 overflow-y-auto`; add `overscroll-contain` so
      pull-to-refresh does not bounce the whole page, and keep the auto-scroll
      effect. The `MessageBubble` `max-w-[75%]` is fine; bump to `max-w-[85%]`
      below `sm` so long messages use the narrow width. Do not change the
      transport, streaming, paywall, or gesture-render logic.

### 4. Surface D: scroll / feeds

16. **Gallery grid md tuning + card aspect: `frontend/components/gallery/CharacterGrid.tsx`**
    - Grid is `grid-cols-2 sm:grid-cols-3 md:gap-5 lg:grid-cols-4`. It sets a
      `md` gap but no `md` column count; add `md:grid-cols-3` explicitly so the
      tablet column count is intentional (prevents oversized cards at `iPad mini`
      744px). Keep the `Load more` button; give it `tap-target`.

17. **Character card touch + image consistency: `frontend/components/gallery/CharacterCard.tsx`**
    - Cards are `aspect-[9/16]` links (good, already a comfortable tap area).
      Keep the `object-cover object-top` so faces are not cropped; ensure the
      `<img>` has `w-full h-full` (it does) so every tile has an identical aspect
      across breakpoints. No layout change needed beyond confirming no
      fixed-pixel width sneaks in.

18. **Reels safe area + momentum: `frontend/components/reels/ReelScroller.tsx`**
    - The scroller already has `snap-y snap-mandatory overflow-y-scroll
      overscroll-contain` and `max-w-[460px]`. Add
      `[-webkit-overflow-scrolling:touch]` for momentum and make the per-reel
      overlay controls (mute/like/Chat Now) `tap-target`. The Chat Now / like
      controls must sit above the home bar: add `pb-safe` to the overlay row.
      Do not change which reel plays or the like POST.

### 5. Regression sweep (grep-driven)

19. **Breakpoint gap sweep**
    - Grep the frontend for `sm:` immediately followed by `lg:` with no `md:`
      in grid/flex column utilities and add an explicit `md:` where a tablet
      would otherwise inherit the `sm` layout. Do not add `md:` cosmetically
      where `sm` is already the intended tablet state; only where the jump
      produces oversized or cramped tiles at 744-1024px.
    - Grep for `fixed`/`sticky bottom-0` elements and confirm each got `pb-safe`.
    - Grep for buttons/links with `h-7`, `h-8`, `p-1`, `p-2` that are primary
      touch targets and add `tap-target` (skip purely decorative `aria-hidden`
      spans like the composer Settings glyph).

## Test instructions
```
# Typecheck + lint (no em dash, strict TS)
npm run typecheck
npm run check:no-em-dash

# Playwright, device-emulated. Add mobile/tablet projects (see below) then:
npx playwright test e2e/mobile-responsive.spec.ts
npx playwright test e2e/mobile-responsive.spec.ts --project="iPhone SE"
npx playwright test e2e/mobile-responsive.spec.ts --project="Pixel 7"
npx playwright test e2e/mobile-responsive.spec.ts --project="iPad mini"

# Full suite across all viewport projects
npx playwright test
```

1. **Add device projects: `playwright.config.ts`** (additive, keep `chromium`)
   - Add projects using `devices` presets + explicit viewports so the matrix is
     reproducible:
     ```ts
     { name: "iPhone SE", use: { ...devices["iPhone SE"] } },
     { name: "iPhone 14", use: { ...devices["iPhone 14"] } },
     { name: "Pixel 7",   use: { ...devices["Pixel 7"] } },
     { name: "iPad mini", use: { ...devices["iPad Mini"] } },
     ```
   - Keep the existing `webServer` block and `baseURL` unchanged.

2. **New spec `e2e/mobile-responsive.spec.ts`** (Playwright)
   - **No horizontal overflow (all four surfaces, public routes)**: for `/`
     (landing) and `/gallery`, assert
     `document.documentElement.scrollWidth <= window.innerWidth + 1` on the
     `iPhone SE` and `Pixel 7` viewports. This is the single most important
     assertion; a body that scrolls sideways is the top mobile bug.
   - **Bottom bar visible + above safe area (mobile only)**: on a mobile project,
     `getByTestId("bottom-chats")` is visible and its bounding box bottom is
     within the viewport (not clipped). On `iPad mini` (`md`) the bottom bar is
     hidden and the `SideNav` (`getByTestId` on a nav item) is visible.
   - **Mobile nav drawer open/close**: tap `mobile-nav-trigger`, assert
     `mobile-nav-drawer` visible, Escape (or scrim tap) closes it. Assert the
     first drawer link is focused (focus trap smoke check).
   - **Tap-target sizes**: assert the bounding box of `chat-send`,
     `mobile-nav-trigger`, and a `MobileBottomBar` link each have
     `height >= 44 && width >= 44`.
   - **Chat panes reachable (seeded, DB-guarded)**: gated behind
     `E2E_SEEDED=1 + E2E_VERIFIED_COOKIE + E2E_CHARACTER_ID` like
     `chat-gestures.spec.ts`. On a mobile project at `/chat/:id`: tap
     `chatlist-trigger` -> `panel-sheet` visible with a conversation search
     input; close; tap `persona-trigger` -> `panel-sheet` visible with the
     persona name. At `lg`/`xl` the inline `ChatList`/`PersonaPanel` render and
     the triggers are hidden.
   - **Keyboard-safe composer (seeded)**: focus `chat-input`, assert the
     `<form>` element's bounding-box bottom stays within the viewport (composer
     pinned, list scrolls under it). This approximates the on-screen keyboard
     without a real device.
   - **Feeds snap (reduced-motion tolerant)**: on the dashboard recents strip and
     the reels scroller, assert the scroll container has
     `scroll-snap-type` set (computed style) so momentum/snap is wired.

   Use `test.describe.configure({ mode: "parallel" })` and
   `test.skip(!seeded ...)` exactly as `chat-gestures.spec.ts` does for the
   DB-backed cases; the public-route assertions run unconditionally.

### Manual device checklist (run on real hardware or DevTools device toolbar)
- [ ] iPhone 14 (notch + home bar): landing, dashboard, chat, reels show no
      content under the notch or home indicator; bottom bar clears the home bar.
- [ ] iPhone SE (375): no surface scrolls horizontally; CTAs are full-width and
      thumb-reachable; chat composer sits above the keyboard when the input is
      focused.
- [ ] Pixel 7 (Android gesture bar): bottom bar + reels controls clear the
      gesture bar; back affordance in chat works.
- [ ] iPad mini (744, portrait): SideNav is visible (not the bottom bar); grids
      show a sensible 3-up (not oversized 2-up); ChatList opens as a sheet, not
      missing.
- [ ] iPad Pro (1024 landscape): layout matches desktop (inline ChatList at
      `lg`, inline PersonaPanel at `xl`).
- [ ] Rotate each phone portrait <-> landscape: no clipped controls, no
      horizontal scrollbar.

## Sanity checklist
- [ ] No surface scrolls horizontally at 375 / 390 / 412 width (landing,
      dashboard, gallery, chat, reels): `scrollWidth <= innerWidth`.
- [ ] `env(safe-area-inset-*)` actually applies (viewport meta has
      `viewport-fit=cover`); bottom bar, chat composer, reels controls, and
      drawers clear the notch/home bar.
- [ ] `ChatList` and `PersonaPanel` are REACHABLE below their inline breakpoints
      via `PanelSheet` (they were `hidden` with no access before); triggers hide
      at `lg`/`xl` where the inline panes appear.
- [ ] Chat composer is sticky above the on-screen keyboard on mobile and the
      message list scrolls under it (`h-dvh` + `sticky bottom-0 pb-safe`).
- [ ] Primary touch targets (bottom-bar tabs, nav trigger, drawer close, chat
      send, chatlist action, load-more, reel controls) are >= 44px.
- [ ] The `md` (tablet) column is explicitly tuned on the dashboard feed grid,
      the gallery grid, and the chat panes; no surface jumps `sm` -> `lg` with an
      oversized/cramped `md`.
- [ ] Horizontal feeds (dashboard recents, marketing reels carousel) snap with
      momentum; vertical reels keep `overscroll-contain` + momentum.
- [ ] Image tiles keep a consistent aspect ratio (`aspect-[9/16]` cards, `9/16`
      persona-gallery tiles, `object-top`) across breakpoints.
- [ ] Back / close affordances exist on mobile chat (top-bar back + sheet close).
- [ ] Dark theme + every `--buttercupp-*` token, `.buttercupp-glass`,
      `.buttercupp-scrim` unchanged; no color/spacing token edited.
- [ ] `npm run typecheck` and `npm run check:no-em-dash` pass; no `any`
      introduced; new drawers are client components, data fetching stays in the
      server components.

## Done criteria
- All four surfaces (marketing, shell+dashboard, chat 3-pane, feeds) pass the
  device matrix (iPhone SE / 14, Pixel 7, iPad mini / Pro) with no horizontal
  overflow, safe-area-clear chrome, 44px touch targets, reachable chat side
  panels, and a keyboard-safe sticky composer.
- `e2e/mobile-responsive.spec.ts` green across the added viewport projects
  (DB-backed chat cases cleanly skipped when unseeded); public-route overflow
  and tap-target assertions green unconditionally.
- Zero regression to desktop layout, the dark theme, design tokens, or any data
  fetching / transport / paywall / gesture logic. Frontend `.tsx` / `.css` only:
  no schema, no API, no migration.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret write, or
ECS/Amplify deploy. This phase touches only frontend `.tsx`/`.css`, so local
work (edits, `npm run typecheck`, `npm run check:no-em-dash`, local
`npx playwright test`, local dev server) proceeds without approval. Prior
approval never carries to the next action; ask fresh, per action.
