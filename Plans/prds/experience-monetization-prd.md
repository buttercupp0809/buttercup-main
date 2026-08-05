# ButterCupp — Experience, Monetization & Prompt PRD (v2)

**Scope:** marketing site, auth polish, Candy/Nastia-inspired product UI, chat gesture formatting, strict paywall + Daily/Weekly/Monthly plans, fill-in prompt structure, memory/RAG + DB hardening.
Status: Draft v1 · Owner: Kshitij · Last updated: 2026-08-02

> This PRD extends the original `prds/master-prd.md`. It is **additive and non-regressive**: it enhances an existing, working build. Every requirement below is mapped to current code state (EXISTS / MISSING) so nothing already shipped is broken.

---

## 0. Ground truth (current state, from code audit)

| Area | Today | Gap this PRD closes |
|---|---|---|
| Landing + top-nav Sign in/up | EXISTS (basic) — `app/page.tsx`, `app/(public)/layout.tsx` | Rebuild landing as a real marketing page (hero, previews, social proof) |
| Legal/footer pages | **MISSING** (age-gate/signup link to `/legal/*` → broken) | Build Terms, Privacy, Cookie, Content, DMCA, 2257, About, Contact + footer |
| Password show/hide + strength | **MISSING** | Add toggle + real-time checklist; strengthen rules |
| Google signup | EXISTS (real) — needs `GOOGLE_CLIENT_ID` | Wire the client GIS button into signup/login |
| Product shell | **Top-nav only** — `app/(protected)/layout.tsx` | Left side-nav app shell (Candy/Nastia style) |
| Logout button | Route exists, **no UI** | Add to sidebar + profile menu |
| Relationship/affection UI | Model exists, **no UI** | Surface affection/mood in chat header |
| Chat gesture formatting | **MISSING** (raw text) | Italic gestures, normal dialogue |
| Typing indicator | **MISSING** | Add |
| Paywall enforcement | `assertCanConsume()` **defined, never called** | Wire strict server-side gating in WS + SSE |
| Plans | free/premium/pro monthly | Daily $1 / Weekly $6 / Monthly $25 + 10 free chats |
| Per-plan limits constants | in `subscription/limits.ts` (tier-based) | New `subscription/plans.ts` (chat/image/video per plan) |
| Prompt layering | EXISTS — `llm/prompts.ts` + `persona-prompts.ts` (8 layers, memory slot) | Refactor into fill-in placeholder templates |
| Memory/RAG | EXISTS + sophisticated | Harden (error handling, transactions, dedup, tests) |

---

## 1. Design direction (product UI)

Reference products: **Candy AI** (most visually polished, image-forward, deep creation, strong memory) and **Nastia AI** (best companion writing + gamification, 8-step builder, group chat). Both are **dark, cinematic, image-forward, sidebar-driven**.

**ButterCupp product aesthetic** = dark, cinematic, sensual-but-refined, image-forward:
- **Theme:** dark base (near-black `#0B0B0F`), warm skin-tone/rose accent (`#FF6B8A`/`#E8A0BF`) + soft violet secondary, high-contrast white text. NOT the current light slate look. (Marketing site may use a lighter hero; the *app* is dark.)
- **Typography:** a distinctive display face for headings (e.g. a warm humanist serif or a characterful grotesque) paired with a clean body sans. Avoid generic Inter-only. (Exact pairing chosen in the build prompt.)
- **Persona cards:** large image-forward cards with gradient scrim, name + tagline overlay, online/mood dot, hover motion.
- **Chat:** immersive — character avatar + subtle blurred character backdrop, message bubbles with the gesture/dialogue distinction, affection meter in header.
- **Motion:** tasteful staggered reveals on load, hover lift on cards, smooth streaming.
- The marketing landing keeps the existing public shell but upgraded; the **in-app** experience is the dark shell.

This is a **visual layer** over existing routes/data — routing, API, and data contracts are unchanged.

---

## 2. Requirements by area

### 2.1 Marketing website (Req 1,2,3,4,5)
- **Landing (`/`)**: hero with dynamic companion previews, value props (unfiltered chat, voice, image, memory, create-your-own), live persona carousel pulling real public characters, social proof, clear CTAs ("Create your companion", "Browse"). Top bar: logo, Browse, **Log in / Sign up**.
- **Footer** (site-wide on public): links to all legal pages, socials, "18+" mark, company line.
- **Legal pages** under `app/(legal)/legal/*`: Terms of Service, Privacy Policy, Cookie Policy, Content/Community Policy, DMCA, USC 2257 Compliance Statement, Refund Policy, About, Contact. Content is templated boilerplate with clearly-marked `{{COMPANY}}`, `{{JURISDICTION}}`, `{{CONTACT_EMAIL}}` placeholders for legal review. **Fixes the existing broken `/legal/terms` + `/legal/privacy` links.**

### 2.2 Auth (Req 6,7)
- **Signup**: email/password **and** Google (GIS button; backend route already exists). Keep DOB + jurisdiction + ToS/Privacy (compliance).
- **Password field**: show/hide eye toggle; **real-time strength checklist** (≥12 chars, uppercase, lowercase, digit, symbol) with pass/fail ticks + strength bar. Submit disabled until all required checks pass.
- **Password rule upgrade** (in `packages/shared/src/dto/auth.ts`): require upper + lower + digit + symbol, min 12. **Server + client share the same schema** (single source of truth). Login keeps lenient rule (accept any existing password).
- Edge cases: existing users with old-rule passwords still log in; reset flow (later) enforces new rule.

### 2.3 Product shell + navigation (Req 8,9,10,11)
- **Left side-nav** (persistent, collapsible on mobile → bottom bar/drawer): **Chats** (recent conversations), **Discover** (new characters/people), **Create** (character wizard), **Settings**, and a **profile menu** at the bottom (avatar, name, tier badge, **Log out**, Profile, Billing).
- **Dashboard** (`/dashboard`): enhanced hub — "Continue" row, "New this week", "Trending", "For you", prominent Create CTA. (Builds on existing dashboard.)
- **Logout**: wire the existing `/api/auth/logout` to a button in the profile menu + settings.
- **Relationship UI**: affection/mood indicator in chat header + optional on character cards (data from `RelationshipState`).

### 2.4 Persona selection (Req 12)
- **Discover/Gallery**: image-forward grid, filters (style, tags, rating, popular/new/trending), search, character detail with "Start chat" CTA. Candy/Nastia-style card + detail. (Enhances existing gallery components.)

### 2.5 Chat experience + gesture formatting (Req 13)
- **THE differentiator**: assistant output renders **physical + emotional gestures in _italics_** and **spoken dialogue/narration in normal text**.
  - **Model side**: the persona/output prompt instructs the model to wrap actions/gestures/emotions in single `*asterisks*` and keep dialogue plain. (Goes in the prompt placeholder structure, §2.7.)
  - **Render side**: `ChatWindow` parses assistant text and renders `*...*` segments as styled italic spans (muted/italic, visually distinct from dialogue). Robust to unmatched/nested asterisks; user messages render plain. Streaming-safe (parse incrementally without flicker).
- Add **typing indicator** ("• • •" animated) while awaiting first token; keep streaming cursor.
- Keep AI-disclosure pill (SB 243), image/voice messages, safety intervention banner — **no regression**.

### 2.6 Strict monetization (Req 14,15)
- **Free trial**: `FREE_MESSAGE_LIMIT = 10` assistant replies (lifetime, configurable). After 10, chat is **hard-blocked** until an active plan.
- **Plans** (duration passes, not recurring tiers): stored in a **single backend constants file** `backend/src/subscription/plans.ts`:
  ```
  FREE      : { priceUsd: 0,  durationDays: 0,  chats: 10 (lifetime), images: 0,  videos: 0 }
  DAILY     : { priceUsd: 1,  durationDays: 1,  chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
  WEEKLY    : { priceUsd: 6,  durationDays: 7,  chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
  MONTHLY   : { priceUsd: 25, durationDays: 30, chats: <TUNE>, images: <TUNE>, videos: <TUNE> }
  ```
  (Exact per-plan chat/image/video numbers are **placeholders you set** — the file is the single source of truth the whole system reads.)
- **Strict, un-bypassable enforcement (server-side only)**:
  - Every chat turn: `assertCanConsume(userId, "chat")` is called in **both** `ws/gateway.ts` (chat.send) **and** `http/chat-stream.ts` **before** `runChatTurn()`. On block → emit `paywall` event (never generate).
  - Every media job: `assertCanConsume(userId, "image"|"video")` before enqueue (already have token debit; add plan quota check).
  - Usage is counted **after** a successful reply via `UsageCounter` (atomic), keyed to the active plan's period.
  - The frontend **cannot** bypass: no client-side counting is trusted; all checks are server-side; the `paywall` signal drives UI only.
- **Payment modal**: on `paywall`, chat input is disabled and a modal shows the 3 plans + "Continue" → checkout (existing CCBill/Verotel/SegPay flow). Chat resumes only after webhook confirms an active plan.
- **Billing page**: replace Free/Premium/Pro cards with Daily/Weekly/Monthly + current plan status, remaining chats/images/videos, expiry.

### 2.7 Prompt placeholder structure (Req 16)
- Refactor prompt building into a **fill-in template system** under `backend/src/llm/prompt-templates/` (composed by `prompts.ts`). Each layer is a named template with **clearly-marked placeholders** you fill with your guideline prompts:
  - `00-base-persona.md` — base companion behavior `{{BASE_PERSONA_GUIDELINES}}`
  - `10-gesture-format.md` — the italics rule (physical/emotional gestures in `*...*`, dialogue plain) `{{GESTURE_STYLE_GUIDELINES}}`
  - `20-character.md` — per-character injection (name/personality/backstory/behavioral)
  - `30-relationship.md` — affection/mood/milestones
  - `40-memory.md` — retrieved memory slot (fills from RAG)
  - `50-content-mode.md` — SFW vs mature guidelines `{{MATURE_GUIDELINES}}` / `{{SFW_GUIDELINES}}`
  - `60-safety.md` — SB 243 / crisis / hard rules (locked, not user-edited)
  - `70-output-rules.md` — length, no-thinking-leak, gesture reminder
- A `PROMPTS.md` index explains **exactly where you paste each guideline** and the composition order. The pipeline reads these at build time (hot-reload in dev). Locked safety layer is not overridable by the placeholders.

### 2.8 Memory / RAG / DB hardening (Req 17)
- **No data loss**: wrap multi-write memory ops (compaction, tiering rebalance) in `prisma.$transaction`; add idempotency/dedup guards; replace `$executeRawUnsafe` with parameterized `$queryRaw` where feasible.
- **Extraction reliability**: keep fire-and-forget (must not block reply) but add retry-once + structured error logging (`logError("memory", …)`), and a dead-letter log so failures are visible.
- **Message integrity**: populate `Message.tokenCost`; ensure every turn persists user + assistant messages atomically; conversation counters consistent.
- **Verification**: a `memory-rag-verify` script + tests that prove: a fact stated turn 1 is retrieved turn 20; per-(user,character) isolation; summaries generated; no duplicate memories under concurrent turns; embeddings dimension = 384.

---

## 3. Data model changes (Prisma, additive)
- `User`: add `freeMessagesUsed Int @default(0)` (lifetime free-trial counter).
- `Subscription`: add `plan` (`free|daily|weekly|monthly`) + keep `currentPeriodEnd` (pass expiry). Keep `tier` for backward-compat mapping.
- `UsageCounter`: reuse for per-plan-period chat/image/video counts (counterType ∈ `chat|image|video`, period = plan period key).
- No destructive migrations; all new columns nullable/defaulted.

## 4. Non-functional / guardrails
- **No regression**: existing routes, WS/SSE event order, AI-disclosure persistence, media lazy-load, wizard step validation, mature gating, account deletion → all preserved and re-verified.
- **Security**: all paywall/limit checks server-side; no client-trusted counters; webhooks idempotent; parameterized SQL.
- **Accessibility**: password toggle + checklist ARIA; sidebar keyboard nav; sufficient contrast on dark theme.
- **Performance**: gesture parsing O(n) streaming-safe; sidebar/dashboard queries paginated.

## 5. Roadmap → Cursor prompts (traceability)
| Cursor prompt | Requirements |
|---|---|
| `14-marketing-site.md` | 1,2,4,5 |
| `15-legal-footer-pages.md` | 3,5 |
| `16-auth-google-password.md` | 6,7 |
| `17-app-shell-sidenav-dashboard.md` | 8,9,10,11 |
| `18-persona-gallery-selection.md` | 8,12 |
| `19-chat-experience-gestures.md` | 13 |
| `20-plans-limits-constants.md` | 15 |
| `21-strict-paywall-triggers.md` | 14,15 |
| `22-prompt-placeholder-structure.md` | 16 |
| `23-memory-rag-db-hardening.md` | 17 |

Every prompt file ends with: **Test instructions**, a **Sanity/regression checklist**, and the **global guardrail** (no commit/deploy/migration without explicit human approval).

## 6. Open items you set (flagged placeholders)
- Exact per-plan chat/image/video numbers in `plans.ts`.
- Whether the 10 free chats are lifetime (default) or per-period.
- Final legal copy (templated with placeholders).
- Guideline prompt content for each `prompt-templates/*` placeholder.
- Exact font pairing + accent hex for the dark theme (a strong default is proposed in prompt 17).
