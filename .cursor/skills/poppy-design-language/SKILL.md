---
name: poppy-design-language
description: Use whenever building, editing, or reviewing any Poppy screen, component, form, or style. Enforces the Poppy visual language (sky + glass), the shared token contract, and the reusable-component rule so features do not fork one-off styles.
---

# Poppy design language (STUB)

Status: Phase 00 stub. UI phases fill this in. Do not one-off styles in the
meantime; if a token is missing, add it here and to `frontend/app/globals.css`
in the same PR.

## Visual system: sky + glass

- Base palette leans on cool sky tones (blues, cool neutrals) with a violet
  accent for interactive emphasis.
- Surfaces are glassy: soft translucency, gentle shadow, `border-white/10` on
  dark and `border-slate-200` on light.
- Motion is calm: 150 to 250ms ease-out for most transitions. No bounce.
- Radii are consistent (`--poppy-radius`, currently 0.75rem). Corners never
  vary within a single surface.

## Design tokens (source of truth)

The tokens live in `frontend/app/globals.css` under `:root`. Reference them
via HSL wrappers (Tailwind arbitrary values or CSS `hsl(var(--poppy-*))`)
rather than hardcoded hex.

Current tokens (see the CSS file for canonical values):

- Color: `--poppy-bg`, `--poppy-fg`, `--poppy-muted`, `--poppy-primary`,
  `--poppy-primary-fg`, `--poppy-accent`, `--poppy-border`.
- Shape: `--poppy-radius`.
- Elevation: `--poppy-shadow-glass`.

Dark mode is handled via `@media (prefers-color-scheme: dark)` today; when the
app introduces an explicit toggle, switch to a `.dark` class and duplicate the
overrides.

## Reusable-component contract

- Always import shared UI from `frontend/components/ui/*` (shadcn/ui pattern).
- Add a new primitive to `components/ui` before using it in more than one
  place. Never inline a bespoke button/input/dialog.
- Compose, do not fork: extend variants via `cva` rather than copy-paste a
  component to tweak it.

## Interaction rules

- Every interactive element has a visible hover state and a visible
  focus-visible ring (2px, offset 2, primary color).
- Contrast: text on any surface meets WCAG AA (4.5:1 for body, 3:1 for large
  text). Verify with a contrast checker before shipping.
- Mobile: touch targets are 44px minimum. Tap zones do not overlap.
- Motion respects `prefers-reduced-motion`; disable non-essential animation
  when the user opts out.

## When this skill applies

Read this file whenever you:

- Build a new page or component in `frontend/`.
- Add or edit CSS in `globals.css` or a component style block.
- Review a PR that touches user-facing surfaces.

If a task needs a token or component that does not exist yet, add it to this
skill and to `globals.css` in the same change.
