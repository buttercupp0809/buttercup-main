---
name: buttercupp-design-language
description: Use whenever building, editing, or reviewing any ButterCupp screen, component, form, or style. Enforces the ButterCupp visual language (warm amber, honey, cream on a cinematic warm-dark base), the shared token contract, and the reusable-component rule so features do not fork one-off styles.
---

# ButterCupp design language

ONE dark, cinematic, warm theme across the WHOLE product (marketing, auth,
onboarding, dashboard, discover, chat, create, billing, legal). The canonical
values live in `frontend/app/globals.css`. This file describes how to use them.
If a token is missing, add it to `globals.css` AND here in the same change.

## Visual system: warm amber + glass

- The palette is taken from the brand mark: amber `#FC9908`, honey `#FFD18D`,
  cream `#FEFDF7`, ink `#272727`. Everything else is a warm neutral ramp built to
  sit under that amber. The base is a warm near-black (never pure `#000`) so the
  amber reads as glow, not a sticker on a void.
- Surfaces are lit objects: layered warm shadows and a hairline top highlight
  (`--bc-shadow*`, `.bc-glass`), not hard outlined boxes.
- Display type is a soft high-contrast serif (Fraunces) via the `font-display`
  class; body/UI is Geist (the default). Headlines look like they belong to the
  wordmark because they share its serif voice.
- Motion is intentional: use the `--ease-out` / `--dur-*` tokens. Entrances are
  fast (`.bc-rise`), presses give feedback (`.bc-press`). No bounce. All motion
  respects `prefers-reduced-motion`.

## Design tokens (source of truth: globals.css `:root`)

Reference tokens via `hsl(var(--bc-*))` (inline `style` or Tailwind arbitrary
values `[hsl(var(--bc-amber))]`). Never hardcode hex/HSL for chrome.

- Brand: `--bc-amber`, `--bc-amber-hot`, `--bc-honey`, `--bc-cream`, `--bc-ink`.
- Warm surface ramp: `--bc-bg`, `--bc-surface`, `--bc-surface-2`, `--bc-surface-3`.
- Text: `--bc-fg` (primary), `--bc-muted`, `--bc-subtle`.
- Borders: `--bc-border`, `--bc-border-strong`.
- Brand gradients: `--bc-gradient-brand`, `--bc-gradient-brand-h`, `--bc-gradient-brand-v`.
- Shape: `--bc-radius-xs..2xl`, `--bc-radius-pill`. Concentric: a child inside a
  padded parent uses the next radius step down.
- Elevation: `--bc-shadow-sm/-/-lg`, `--bc-shadow-glow`, `--bc-inset-hairline`.
- Semantic: `--bc-success`, `--bc-warning`, `--bc-danger`.
- Ember: `--bc-ember` (red) is SEMANTIC, for hearts / likes / affection / bond
  meters ONLY. Never use it for chrome or CTAs. Amber cannot carry "affection",
  and red cannot carry "brand".

Legacy `--buttercupp-*` aliases are repointed at the warm palette for back-compat;
prefer the `--bc-*` names in new code.

The app renders in one theme via `.dark` on `<html>`. Do not add a light mode.

## Reusable classes (prefer these over bespoke styles)

Defined in `globals.css`: `.bc-glass` / `.buttercupp-glass` (glass surface),
`.bc-chip`, `.bc-pill`, `.bc-media` / `.bc-media-lift`, `.bc-ring`, `.bc-bubble`
(`.bc-bubble-her` / `.bc-bubble-me`), `.font-display`, `.tabular`, `.bc-press`,
`.bc-focus`, `.pt-safe` / `.pb-safe` / `.px-safe` (safe-area insets),
`.bc-rise`, `.bc-skeleton`, `.bc-grain` (global noise layer).

## Reusable-component contract

- Import shared UI from `frontend/components/ui/*`. Use the `Button` (with its
  `cva` variants, including `variant="brand"`) rather than a bespoke button.
- Add a primitive to `components/ui` before using it in more than one place.
- Compose, do not fork: extend variants via `cva`, never copy-paste to tweak.

## Chrome vs content

- Restyle CHROME (surfaces, buttons, headings, borders, focus rings, nav, chips)
  to the amber system.
- Leave CONTENT/ART alone: character photos, and depictive illustrations that
  represent a choice (e.g. the realistic/3D/anime style-preview thumbnails in
  `create/style`) are content, not theme, and keep their own colors.

## Interaction rules

- Every interactive element has a visible hover state and a visible
  focus-visible ring (amber; use `.bc-focus` or `focus-visible:ring-[hsl(var(--bc-amber))]`).
- Primary CTAs use the brand gradient with dark ink text (`hsl(28 45% 9%)`) for
  AA contrast. Do not put white text on amber.
- Contrast meets WCAG AA (4.5:1 body, 3:1 large). Mobile tap targets >= 44px.
- Primary headings use `font-display`.

## House rules

- No em dash (U+2014) anywhere. Enforced by `eslint.config.mjs` and
  `npm run check:no-em-dash`.
- Mobile-first: use `px-safe`/`pb-safe` on full-bleed screens; horizontal
  scrollers (tag rails, dashboard rails) instead of wrapping blocks on phones.

## When this skill applies

Read this whenever you build a page/component in `frontend/`, edit `globals.css`
or a style block, or review a PR that touches user-facing surfaces. If a task
needs a token or class that does not exist, add it to `globals.css` and here in
the same change.
