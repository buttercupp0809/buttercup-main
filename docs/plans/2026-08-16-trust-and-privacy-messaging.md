# Trust and Privacy Messaging Implementation Plan

**Goal:** Convey ButterCupp's real (honest) security posture across every surface a prospective and returning user touches (marketing, auth, onboarding, in-app, settings, footer) with playful, layman copy that builds trust without overclaiming.

**Architecture:** Three shared UI primitives in `frontend/components/trust/*` plus one dedicated `/legal/privacy-promise` deep page. Every consumer surface imports the primitives; nothing forks copy. Copy is centralized inside the primitives so a single edit updates every surface.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, existing ButterCupp design tokens (rose + violet).

**Honest posture (agreed with product):** TLS in transit + AWS-managed KMS at rest, `ownerUserId` scoping per companion, 18+ age gate, one-click delete of companion or account, no sale of data, no use of private chats to train third-party models. We do NOT claim E2EE, zero-knowledge, or "bank-level" (regulator red flag).

---

## Surfaces changed

| Surface | File | Change |
| --- | --- | --- |
| Marketing home | `frontend/app/(public)/page.tsx` | Insert `<TrustPromise />` between `<ValueProps />` and `<SocialProof />`. |
| Login | `frontend/app/login/LoginForm.tsx` | `<TrustStrip />` under the sign-in card. |
| Signup | `frontend/app/signup/SignupForm.tsx` | `<TrustStrip />` under the CTA, above the ToS line. |
| Onboarding step 1 | `frontend/app/onboarding/identity/page.tsx` | Prepend a friendly "before we begin" trust callout using shared copy. |
| Chat header | `frontend/components/chat/ChatWindow.tsx` | Tiny `<LockedBadge />` next to the character name. |
| Settings | `frontend/app/(protected)/settings/SettingsClient.tsx` | New "Your privacy" section linking to the deep page. |
| Footer + deep page | `frontend/lib/legal/config.ts` + `frontend/app/(legal)/legal/privacy-promise/page.tsx` | Register a new legal-group entry; footer picks it up automatically. |

## New primitives

- `frontend/components/trust/TrustPromise.tsx`: big four-card block for marketing and onboarding.
- `frontend/components/trust/TrustStrip.tsx`: compact horizontal chip strip for auth pages.
- `frontend/components/trust/LockedBadge.tsx`: inline chip with a lock glyph, used inside chat header and settings.
- `frontend/components/trust/copy.ts`: single source of truth for every promise string.

## Copy platform (layman, no jargon)

1. Locked and sealed. Everything you send is scrambled on the way in and locked in a vault at rest. Even we cannot casually peek.
2. Yours alone. Every companion belongs to you. Nobody else sees them. Not on search engines, not in our marketing, not anywhere.
3. Never trained on. Your private chats are not sold and are not used to train anyone else's AI. Full stop.
4. Yours to erase. One tap deletes a companion. One tap wipes your account. Gone means gone.

Compact chips (used in auth strip): "Locked and private", "Yours alone", "18+ only", "Delete anytime".

## Sanity checks

- `npm run typecheck` clean.
- `npm run check:no-em-dash` clean (no `\u2014`).
- Footer shows a new "Privacy Promise" link under Legal.
- Marketing home renders the four-card block without layout shift.
- Login and signup pages show the strip on desktop and mobile without pushing the form off-screen.
- Chat header shows the lock chip and keeps the affection meter intact.
- Settings shows a new privacy section that links to `/legal/privacy-promise`.
- No functional behavior changes; this is purely additive UI.
