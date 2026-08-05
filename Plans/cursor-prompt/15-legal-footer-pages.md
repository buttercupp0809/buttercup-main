# Phase 15: Legal + footer pages

## Goal
Create the legal pages the app already links to but does not have. Today `frontend/app/(auth)/age-gate/page.tsx` and `frontend/app/signup/page.tsx` link to `/legal/terms` and `/legal/privacy`, and the Phase 14 footer links to seven more legal routes, all of which currently 404. Build a `(legal)` route group with a shared, readable legal layout and these pages: Terms of Service, Privacy Policy, Cookie Policy, Content/Community Policy, DMCA, USC 2257 Compliance Statement (mature-content record-keeping), Refund Policy, About, and Contact. Content is templated boilerplate with clearly-marked placeholders (`{{COMPANY}}`, `{{JURISDICTION}}`, `{{CONTACT_EMAIL}}`, `{{LAST_UPDATED}}`) for legal review, not final legal copy. Every footer, age-gate, and signup legal link must resolve.

This phase covers PRD (`prds/experience-monetization-prd.md`) §2.1 (legal pages under `app/(legal)/legal/*`, fixing the broken `/legal/terms` + `/legal/privacy` links). No auth is required to view legal pages.

## Prerequisites
- Existing broken links to fix: `frontend/app/(auth)/age-gate/page.tsx` (lines linking `/legal/terms`, `/legal/privacy`), `frontend/app/signup/page.tsx` (the ToS + Privacy checkboxes should link to the same routes).
- Phase 14 `Footer` (if shipped) links these exact slugs: `terms`, `privacy`, `cookie`, `content-policy`, `dmca`, `2257`, `refund`, `about`, `contact`. Keep these slugs identical so the footer resolves. If Phase 14 has not shipped, still build all nine pages.
- No DB, no auth, no migration involved. These are static server-rendered content pages.

## Context to paste into Cursor
```
You are building Phase 15 of "Poppy" (mature-gated AI companion platform): the public legal + footer content pages, and fixing the currently-broken /legal/* links.

Authoritative spec: prds/experience-monetization-prd.md §2.1. Requirements:
- Create app/(legal)/legal/* pages: Terms of Service, Privacy Policy, Cookie Policy, Content/Community Policy, DMCA, USC 2257 Compliance Statement, Refund Policy, About, Contact.
- Content is TEMPLATED BOILERPLATE with clearly-marked placeholders for legal review, NOT final legal copy: {{COMPANY}}, {{JURISDICTION}}, {{CONTACT_EMAIL}}, {{LAST_UPDATED}}. Every page shows a "This is a draft template pending legal review" banner and a Last updated line.
- This fixes the existing broken /legal/terms and /legal/privacy links used by the age gate and signup.
- Legal pages require NO auth and NO age gate: a logged-out visitor can read all of them.

Poppy is a mature-gated (18+) AI companion product with AI voice, AI images, and a strict paywall (Daily/Weekly/Monthly passes + 10 free chats), so the boilerplate must at minimum acknowledge: AI-generated companions and content, 18+ / adult content, the USC 2257 record-keeping statement for mature imagery, a refund/duration-pass policy, DMCA takedown contact, and California SB 243 AI-disclosure framing. These are placeholders for counsel, not legal advice.

Hard rules: TypeScript strict; server-centric Next.js 16 App Router; no auth on these routes; no em dashes anywhere; do not invent a real company name or address (leave placeholders).
Do NOT run git commit/push, deploy, or migrate a non-local DB.
```

## Build steps

### 1. Shared legal config + placeholders
- `frontend/lib/legal/config.ts`. Export a single `LEGAL = { COMPANY: "{{COMPANY}}", JURISDICTION: "{{JURISDICTION}}", CONTACT_EMAIL: "{{CONTACT_EMAIL}}", LAST_UPDATED: "{{LAST_UPDATED}}" }` object plus a `LEGAL_PAGES` array of `{ slug, title, group }` (group is `legal` or `company`) for Terms, Privacy, Cookie, Content, DMCA, 2257, Refund, About, Contact. The Phase 14 footer can import `LEGAL_PAGES` so the two stay in sync. Keeping placeholders in one object makes the legal-review find/replace a single pass. Do NOT resolve placeholders from env; they are literal placeholder strings until counsel supplies copy.

### 2. Shared legal layout
- `frontend/app/(legal)/layout.tsx`. A public server layout wrapping all legal pages with readable long-form typography: a centered narrow measure (about `max-w-3xl`), comfortable line-height, styled headings/lists/links (Tailwind typography classes or hand-rolled), and a top bar with a "Back to Poppy" link home. Do NOT call `requireAuth()`; these are public. If Phase 14 mounted the `Footer` only on `(public)`, either reuse the shared `Footer` component here too or add a minimal footer link back to `/`.
- `frontend/components/legal/LegalPage.tsx`. A reusable presentational wrapper: props `{ title: string; children: React.ReactNode }`. Renders an H1 title, a prominent "Draft template pending legal review" banner, a "Last updated: {{LAST_UPDATED}}" line pulled from `LEGAL.LAST_UPDATED`, then the body. Give the article `data-testid="legal-page"` so tests can assert it rendered.

### 3. The nine pages
Under `frontend/app/(legal)/legal/`, one folder per slug, each a server component rendering `<LegalPage title=...>` with templated section content that interpolates `LEGAL.*` placeholders:
- `terms/page.tsx` (Terms of Service): acceptance, eligibility (18+), account, acceptable use, AI-generated-content disclaimer + SB 243 AI-disclosure note, subscriptions/duration passes, termination, liability, governing law `{{JURISDICTION}}`.
- `privacy/page.tsx` (Privacy Policy): data collected (email, DOB, jurisdiction, chat/usage), purpose, processors (LLM/voice/image/payment providers), retention, user rights, `{{CONTACT_EMAIL}}`.
- `cookie/page.tsx` (Cookie Policy): the auth cookie and any analytics, categories, how to control them.
- `content-policy/page.tsx` (Content/Community Policy): what is allowed vs prohibited, prohibited-content list (CSAM zero-tolerance, non-consensual, etc.), reporting, enforcement, appeals.
- `dmca/page.tsx` (DMCA): takedown + counter-notice process, designated agent placeholder, `{{CONTACT_EMAIL}}`.
- `2257/page.tsx` (USC 2257 Compliance Statement): a mature-content record-keeping / age-representation statement noting AI-generated imagery, custodian-of-records placeholder, `{{COMPANY}}` / `{{JURISDICTION}}`. Route path is literally `/legal/2257`.
- `refund/page.tsx` (Refund Policy): duration-pass model (Daily/Weekly/Monthly), non-refundable vs refundable cases, how to request via `{{CONTACT_EMAIL}}`.
- `about/page.tsx` (About): short company-mission placeholder, 18+ positioning.
- `contact/page.tsx` (Contact): `{{CONTACT_EMAIL}}` and a placeholder mailing address, support expectations. (A form is out of scope; a mailto link is enough.)

Each page should `export const metadata = { title: "<Page> | Poppy" }` and may `export const dynamic = "force-static"` since content is static.

### 4. Fix the broken links
- `frontend/app/(auth)/age-gate/page.tsx`. The ToS + privacy `<a href="/legal/terms">` / `/legal/privacy` links now resolve; open them in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) so the user does not lose the gate form. No behavior change beyond that.
- `frontend/app/signup/page.tsx`. Make the "I accept the Terms of Service" and "I accept the Privacy Policy" labels link the words "Terms of Service" and "Privacy Policy" to `/legal/terms` and `/legal/privacy` (new tab). Do NOT touch the existing `errorMessage` helper or the submit flow.

## Test instructions
```
# E2E (Playwright): from repo root, dev server auto-starts
npm run test:e2e -- legal       # add e2e/legal.spec.ts covering:
# - each legal slug returns 200 and renders [data-testid="legal-page"]:
#     /legal/terms /legal/privacy /legal/cookie /legal/content-policy
#     /legal/dmca /legal/2257 /legal/refund /legal/about /legal/contact
# - the "Draft template pending legal review" banner is visible on each page
# - a link-crawl of the site footer, the /age-gate ToS/Privacy links, and the /signup ToS/Privacy links all resolve (status < 400)
# - legal pages load while LOGGED OUT (no redirect to /login)

# Manual
npm run dev:frontend   # visit /signup and /age-gate, click the ToS + Privacy links, confirm they open the real pages
```

## Sanity checklist
- [ ] All nine `/legal/*` routes exist and return 200 while logged out (no auth, no age gate).
- [ ] Every page shows the "Draft template pending legal review" banner and a "Last updated" line, and uses the `{{COMPANY}}` / `{{JURISDICTION}}` / `{{CONTACT_EMAIL}}` / `{{LAST_UPDATED}}` placeholders from `frontend/lib/legal/config.ts`.
- [ ] `/legal/terms` and `/legal/privacy` (the previously-broken links) resolve; the age-gate and signup ToS/Privacy links open them in a new tab without losing form state.
- [ ] The `2257` page is served at the literal path `/legal/2257`.
- [ ] Footer legal slugs (Phase 14) match the routes built here exactly; a footer link-crawl finds no 404s.
- [ ] No real company name, address, or agent details are invented; everything sensitive is a marked placeholder.
- [ ] The signup `errorMessage` helper and submit flow are untouched; the age-gate submit flow is untouched.
- [ ] No em dashes in the diff.

## Done criteria
Every legal link in the product resolves: the footer, the age gate, and the signup checkboxes all reach real, readable, publicly-viewable legal pages built from a single placeholder config so counsel can do one find/replace pass. No auth is needed to view them, and the previously-broken `/legal/terms` + `/legal/privacy` links work. All Playwright checks above pass locally.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy, or migration against a non-local database. Local unit/E2E tests and dev servers are fine. When unsure whether an action is prod-touching, assume it is and ask first. The templated legal copy is a placeholder for counsel, not legal advice, and must not ship as-is without human legal review.
