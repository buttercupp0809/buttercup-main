# Poppy — Master PRD

**Competitive AI Companion Platform**
Status: Draft v1.0 · Owner: Kshitij · Last updated: 2026-07-30

> This is the authoritative product + technical requirements document for Poppy. It is the single source of truth that the phased Cursor implementation prompts in `cursor-prompt/` build against. When code and this PRD disagree, update this PRD in the same change.

---

## 0. Locked decisions (read first)

| Decision | Choice | Consequence |
|---|---|---|
| **Content maturity** | Mature / uncensored from day 1 | Web-only distribution (no App/Play Store), age-verification vendor required, adult-friendly payment processor (not Stripe), uncensored model via OpenRouter, SB 243 self-harm protocol mandatory |
| **Infrastructure** | Mirror Pellow — AWS | Amplify (frontend) + ECS Fargate (backend) + RDS Postgres + pgvector + ElastiCache Redis + S3 + CloudFront |
| **Phase-1 MVP scope** | All four hard capabilities in | RAG memory + character-creation wizard + voice TTS + AI image generation all ship in MVP |
| **Client** | Web-first responsive PWA | Single Next.js 16 app, installable; native mobile deferred to a later phase |

These four decisions are settled. Do not reintroduce SFW-only, Vercel/Neon, or native-first assumptions anywhere in the build.

---

## 1. Overview & vision

### 1.1 Product thesis
Poppy is an AI companion platform where users chat with richly-personified AI characters that **remember**, **speak** (voice), **send selfies** (image), and can be **created and shared** by users. It competes in the Character.AI / Candy.AI / Janitor AI category, positioned on three wedges competitors execute poorly:

1. **Memory that actually persists** — the #1 recurring complaint across every competitor is that companions forget. Poppy treats long-term RAG memory as the core product, not a feature.
2. **True multimodality in one place** — streaming text + per-character voice + character-consistent image generation, unified under one relationship, not bolted on.
3. **Creator-grade character creation** — a guided wizard producing consistent, publishable personas (appearance sheet + voice profile + personality), feeding a community gallery.

### 1.2 Target user
- Primary: 18+ users seeking immersive, unfiltered companionship, roleplay, and creative chat (mature-gated).
- Secondary: creators who design and publish characters for the community.

### 1.3 Positioning
| Competitor | Strength | Gap Poppy exploits |
|---|---|---|
| Character.AI | Scale, creation | SFW-filtered; weak memory; no real voice/image depth |
| Replika | Emotional bond | Single companion; dated; limited creation |
| Candy.AI | Visual gratification | Thin memory; limited user creation |
| Janitor AI | Uncensored, BYO-model | Technical UX; no integrated voice/image/memory |

Poppy = uncensored + deep memory + integrated voice/image + strong creation, in a polished web-first PWA.

---

## 2. Market & competitive context

- **Market size**: ~$8.36B (2025), ~20.7% CAGR to 2035. 220M cumulative downloads by mid-2025; H1-2025 downloads +88% YoY.
- **Monetization split**: subscriptions = 70–85% of revenue; microtransactions (tokens, image credits, voice packs) = 15–30%. → **Poppy must support both a subscription tier and a consumable token economy from MVP.**
- **The memory gap**: the single loudest user complaint across platforms is lack of memory → our central differentiator.
- **Compliance is now statutory**: California SB 243 (effective Jan 1, 2026) mandates AI-disclosure, a self-harm/suicide-ideation intervention protocol, break reminders for minors, and creates a **private right of action ($1,000/violation)**. EU AI Act + UK Online Safety Act + GDPR/CCPA add obligations. → **Safety/compliance is a first-class module.**

Sources (for reference in the doc, not links in code): TechCrunch (companion apps $120M 2025), SNS Insider market report, SB 243 (LegiScan / Jones Walker / FPF analyses).

---

## 3. Personas & core user journeys

### 3.1 Personas
- **Visitor** — unauthenticated, browsing the public gallery, evaluating.
- **Member (free)** — signed up, age-verified, chatting with limited daily messages and no premium media.
- **Subscriber (Premium/Pro)** — full chat, memory depth, voice, image credits.
- **Creator** — designs and publishes characters; (creator monetization is a later phase).

### 3.2 Primary journey (maps to the 9 screens in the brain dump)
```
Landing → Age & compliance gate → Signup/Login → Public gallery (preview)
   → [auth] Dashboard/feed → Chat (stream + voice + image) → Create-character wizard
   → Subscribe / buy tokens → Settings
```

Screen inventory (from brain dump):
- **Pre-auth**: Landing, Age/Compliance modal, Login/Signup, Public gallery preview.
- **Post-auth**: Dashboard/feed, Chat interface, Character-creation wizard (5 steps), Subscription/billing, Settings/account.

---

## 4. Scope

### 4.1 Phase-1 MVP (this build)
Baseline (always in): auth + age gate, character gallery + discovery, streaming text chat, subscription + token billing, settings, safety/compliance core.
Plus all four hard capabilities: **RAG memory, character-creation wizard, voice (TTS), AI image/selfie generation.**

### 4.2 Later phases (not now)
Native mobile (React Native), video generation, real-time voice calls, creator revenue-share/monetization, advanced moderation ML, multi-language voice depth, group/multi-character scenes.

---

## 5. Functional requirements (by domain)

### 5.1 Auth & age verification
- Email/password + OAuth (Google) signup/login; passwordless magic-link supported (Pellow pattern).
- **Age & compliance gate** before any character interaction: date-of-birth capture + ToS/privacy acceptance; jurisdiction capture.
- **Age verification vendor abstraction** (`AgeVerificationProvider` interface) — self-declaration for baseline gate; escalated verification (ID/age-estimation vendor) triggered by mature content access and jurisdiction rules.
- Sessions via httpOnly cookie JWT (`jose`), audience-scoped; middleware guards protected routes.

### 5.2 Character system
- Three ownership classes: **system** (curated launch roster), **user-created private**, **user-created public**.
- `Character` + immutable `CharacterVersion` (edits create versions; conversations pin a version for consistency).
- Each character has: identity (name, age 18+, gender, bio, tags), **AppearanceSheet** (physical traits, style, negative prompts → image-gen template), **VoiceProfile** (TTS voice id/params), personality (traits, backstory, greeting, behavioral instructions), `contentRating` (sfw | mature), visibility (private | public), and moderation status.
- **Gallery & discovery**: grid of cards (avatar, name, bio, tags), sort (popular/new/trending), filter (style, tags, rating), search; character detail page; restricted CTA prompting signup for visitors.

### 5.3 Chat (core workspace)
- Real-time **token-by-token streaming** responses; typing indicators; markdown rendering.
- Scrollable history persisted per `Conversation` (user × character).
- Rich input bar: text, voice-note request, image/selfie request, attachment.
- Header: character avatar/name + **relationship/affection status** (from `RelationshipState`) + settings.
- Mandatory **AI-disclosure** indicator (SB 243).

### 5.4 Memory (RAG)
- Extract salient facts + summaries from conversation (memory extractor).
- Store embeddings in **pgvector**; hybrid keyword + semantic retrieval of top-K into the prompt.
- Summarization + tiering (hot/warm/cold) + compaction to control context size (Pellow patterns).
- Per-(user,character) memory isolation; user-visible + editable/clearable in settings.

### 5.5 Voice (TTS)
- Per-character voice via provider chain (ElevenLabs Flash v2.5 primary → Cartesia → Google fallback).
- **Voice-decision** logic (when a reply is sent as voice). Streaming audio; audio player with waveform. Debits token credits.

### 5.6 Image / selfie generation
- Character-**consistent** generation: per-character reference sheet + LoRA / IP-Adapter conditioning (Fal.ai or Replicate; SDXL/Flux).
- Triggered from chat ("send a selfie") or character setup (avatar/portrait).
- **Asynchronous** via media queue; result pushed to client on ready and persisted to S3. Debits token credits.

### 5.7 Character-creation wizard (5 steps)
1. **Style** — Hyper-realistic / Stylized 3D / Anime → sets generation pipeline params.
2. **Identity** — name, age (18+ enforced), gender, initial avatar (upload or generate).
3. **Appearance** — physical traits, clothing/style, optional negative prompts → AppearanceSheet template.
4. **Personality & voice** — backstory/lore, trait tags + custom behavioral instructions, greeting message, voice selection.
5. **Privacy & publish** — private/public, content rating; on finish: persist, index for search, route to chat.
Live preview thumbnail; draft autosave.

### 5.8 Billing (tiers + token economy)
- Tiers: **Free**, **Premium**, **Pro** (feature + limit matrix).
- **Token/credit ledger** for consumables (image gen, voice gen, premium-model messages).
- **Adult-friendly payment processor** abstraction (`PaymentProvider`) — Stripe is not usable for mature content; target CCBill / Verotel / SegPay / crypto. Webhooks normalized like Pellow's multi-provider payment layer.
- Paywall + usage limits enforced server-side.

### 5.9 Safety & compliance
- **Crisis detection** (fast flags + LLM) → **SB 243 self-harm/suicide protocol** (intervention message + resources + block harmful content generation).
- **AI-disclosure** persistent in chat UI.
- **Break reminders** (SB 243) at continuous-use thresholds.
- **Jurisdiction gating** (mature content availability by region).
- Content moderation on user-created public characters before publish.
- Audit logging of safety events.

### 5.10 Settings & account
- Profile edit, password change, chat/memory management (view/clear/export), content-safety preferences, theme, **data export + account deletion** (GDPR/CCPA).

---

## 6. Non-functional requirements

| Dimension | Target |
|---|---|
| Chat first-token latency | < 1s p50, < 2s p95 |
| Voice time-to-first-audio | < 1.5s p50 (ElevenLabs Flash + connection pre-warm) |
| Image gen turnaround | < 15s typical (async; UI non-blocking) |
| Streaming | token-by-token; no full-response blocking |
| Availability | 99.5%+ MVP |
| Cost ceilings | per-generation cost tracked; token pricing covers COGS with margin |
| Scalability | stateless API/WS nodes behind ALB; horizontal scale on ECS; Redis for queue + presence |
| Security | httpOnly cookies, timing-safe auth, server-side validation (Zod), least-privilege IAM |

---

## 7. System architecture

```
Client (Next.js 16 PWA, web-first)
  REST (Next API routes) ── auth, CRUD, billing, gallery, wizard
  WebSocket ────────────── chat streaming, typing, media-ready push
        │
        ▼
API/WebSocket Gateway (ECS Fargate, Node)  ── JWT + subscription + age-gate validation, rate limit
        │
  ┌─────┴───────────────────────────────────────────────┐
  ▼                        ▼                              ▼
Conversation Engine   Orchestration (BullMQ+Redis)   Safety/Compliance
  - LLM provider chain   - image job (Fal/Replicate/SDXL)  - crisis detector
    (OpenRouter uncens.   - voice job (ElevenLabs)          - SB243 protocol
     + Claude/GPT prem.)  - video job (phase 2)             - AI disclosure
  - system-prompt layers  → results to S3, push via WS      - break reminders
  - RAG retrieval                                            - age verification
        │
        ▼
Data: RDS Postgres + pgvector │ S3 (media) │ ElastiCache Redis (queue/presence)
```

### 7.1 Inherited from Pellow (conventions, reused verbatim)
- Monorepo npm workspaces: `frontend/`, `backend/`, `packages/database/`, `packages/shared/`.
- `packages/database`: Prisma 6 + Postgres + pgvector, **singleton** export (`import { prisma } from "@poppy/database"`; never `new PrismaClient()`). Ref `../Pellow/packages/database/src/client.ts`.
- Multi-provider LLM fallback with lazy init + graceful degradation. Ref `../Pellow/backend/src/llm/provider.ts`.
- RAG memory extractor/retriever/compactor/tiering + hybrid search. Ref `../Pellow/backend/src/llm/memory-*.ts`, `../Pellow/backend/src/memory/*`, `../Pellow/backend/src/knowledge/store.ts`.
- Voice provider chain. Ref `../Pellow/backend/src/media/voice.ts`. Image decision/prompt split. Ref `../Pellow/backend/src/media/image*.ts`.
- Safety/crisis detection. Ref `../Pellow/backend/src/safety/*`.
- Utils: `retry.ts` RETRY_PRESETS, `safe-types.ts`, `audit.ts`, `config/flags.ts`. Ref `../Pellow/backend/src/utils/*`.
- Cookie JWT auth (`jose`) + middleware guards. Ref `../Pellow/frontend/lib/auth.ts`, `../Pellow/frontend/middleware.ts`.
- Design tokens as CSS vars + reusable component library + `.cursor` design-language skill. Ref `../Pellow/frontend/app/globals.css`, `../Pellow/.cursor/skills/vesspr-design-language/SKILL.md`.
- Frontend: Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui, Zod, server-centric, minimal client state.
- Testing: Vitest + Playwright. Deploy: multistage Dockerfile (non-root, tini, ffmpeg), Amplify + ECS + RDS (`pgbouncer=true`).

### 7.2 Deliberate divergences from Pellow (net-new)
1. **Real-time transport** — Pellow polls; Poppy adds a WebSocket gateway on ECS for streaming + typing + media-ready push, with SSE fallback for token streaming.
2. **Async media queue** — BullMQ + Redis worker; media never blocks chat (Pellow generates media synchronously).
3. **Multi-character model** — `Character`/`CharacterVersion`, per-(user,character) `Conversation` + `RelationshipState` (Pellow = one companion per user).
4. **Mature-gating layer** — `AgeVerification`, `contentRating`, jurisdiction gating, SFW/uncensored model routing, adult-friendly payment abstraction.
5. **Token economy** — consumable credits on top of subscription tiers.

---

## 8. Data model (Prisma outline)

pgvector-indexed fields marked ⓥ. All ids `cuid`/`uuid`. Timestamps on every table.

- **User** — email, passwordHash?, oauthProvider?, dob, jurisdiction, subscriptionTier (`free|premium|pro`), tokenBalance, ageVerifiedAt?, ageVerificationLevel, createdAt.
- **AgeVerification** — userId, provider, level (`self_declared|vendor_verified`), status, evidenceRef?, verifiedAt.
- **Character** — ownerUserId? (null = system), name, age, gender, bio, tags[], style (`realistic|3d|anime`), contentRating (`sfw|mature`), visibility (`private|public`), moderationStatus, currentVersionId, popularityScore.
- **CharacterVersion** — characterId, versionNo, personality, backstory, behavioralInstructions, greeting, appearanceSheetId, voiceProfileId, systemPromptSnapshot.
- **AppearanceSheet** — traits (hair/eye/body/features/clothing), stylePrompt, negativePrompt, referenceImageKeys[], loraRef?.
- **VoiceProfile** — provider, voiceId, params, previewKey?.
- **Conversation** — userId, characterId, characterVersionId (pinned), lastMessageAt, messageCount.
- **Message** — conversationId, role (`user|assistant|system`), content, mediaAssetId?, tokenCost?, createdAt.
- **Memory** ⓥ — userId, characterId, content, category, embedding, tier (`hot|warm|cold`), salience, sourceMessageId?.
- **MemorySummary** — userId, characterId, periodStart/End, summary, embedding ⓥ.
- **RelationshipState** — userId, characterId, affectionLevel, milestones[], mood, updatedAt.
- **Subscription** — userId, provider, tier, status, currentPeriodEnd, externalId.
- **TokenLedger** — userId, delta, reason (`purchase|image_gen|voice_gen|premium_msg|grant`), balanceAfter, refId.
- **MediaAsset** — userId, characterId?, kind (`image|voice|video`), s3Key, status (`queued|processing|ready|failed`), jobId, meta.
- **CrisisEvent** — userId, level, trigger, action, createdAt.
- **AuditLog** — action, userId?, ip?, userAgent?, metadata (fire-and-forget writes).
- **AnalyticsEvent** — userId?, name, props, createdAt.
- **FeatureFlag** — key, enabled, rollout, metadata.

---

## 9. API surface

### 9.1 REST (Next.js API routes)
- `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/oauth/google`, `/api/auth/magic-link`.
- `POST /api/age/verify` — record gate + escalate to vendor when required.
- `GET /api/characters` (gallery, filter/sort/search), `GET /api/characters/:id`, `POST /api/characters` (create), `PATCH /api/characters/:id` (new version), `POST /api/characters/:id/publish`.
- `GET /api/conversations`, `POST /api/conversations` (start with character), `GET /api/conversations/:id/messages`.
- `POST /api/media/image`, `POST /api/media/voice` (enqueue; returns jobId), `GET /api/media/:id`.
- `GET /api/memory`, `DELETE /api/memory/:id` (user memory management).
- `POST /api/billing/subscribe`, `POST /api/billing/tokens`, `POST /api/webhooks/:provider`.
- `GET /api/me`, `PATCH /api/me`, `POST /api/me/export`, `DELETE /api/me`.

### 9.2 WebSocket event contract (client ↔ ECS gateway)
- Client→server: `chat.send` {conversationId, text}, `chat.cancel`, `typing.start/stop`, `media.request` {kind, conversationId}.
- Server→client: `chat.token` {delta}, `chat.done` {messageId}, `typing.indicator`, `media.ready` {mediaAssetId, url}, `relationship.update`, `safety.intervention`, `error`.
- Auth on WS handshake via cookie JWT; per-connection subscription + age-gate + rate-limit validation.

All DTOs validated with **Zod** in `packages/shared`.

---

## 10. AI / LLM design

- **Provider chain** (lazy init, graceful fallback, Pellow pattern):
  1. OpenRouter (uncensored/roleplay-tuned open models — Llama/Mistral/DeepSeek/GLM class) — primary for mature chat.
  2. Premium API (Claude / GPT) — quality tier / SFW-flagged characters.
  3. Hardcoded fallback response on total failure.
- **Model routing** by `character.contentRating` + jurisdiction + user tier.
- **System-prompt architecture** (layered, dynamically composed per turn): base persona/behavioral instructions → character state → `RelationshipState` (affection/mood) → **retrieved memory injection** (top-K) → safety guardrails → AI-disclosure constraints.
- **Memory pipeline**: after each turn, async extract facts/summaries → embed → store; before each turn, hybrid-retrieve top-K + latest summary.
- **Safety interception order**: crisis-detect BEFORE generation; if urgent → SB 243 protocol path (no normal generation). Reasoning-leak guardrail (strip thinking blocks) like Pellow's LLM client.

---

## 11. Media pipeline

- **Image (character consistency)**: each character has an AppearanceSheet (traits + style + negative prompt) + reference image(s); consistency via LoRA or IP-Adapter conditioning on SDXL/Flux through **Fal.ai or Replicate**. Prompt-crafting split (decision → prompt build → enqueue), mirroring Pellow's `image-decision.ts` / `image-prompt.ts`.
- **Voice**: ElevenLabs Flash v2.5 over WebSocket streaming, connection pre-warm to cut TTFA; provider chain fallback. Mirrors Pellow `voice.ts`.
- **Queue**: BullMQ jobs on Redis; worker in backend; statuses on `MediaAsset`; on ready, upload to S3 and emit `media.ready` over WS.
- **Token accounting**: each job debits `TokenLedger` atomically; insufficient balance → paywall response.

---

## 12. Compliance & safety

- **SB 243 checklist**: (a) AI-disclosure default + persistent; (b) self-harm/suicide-ideation protocol; (c) break reminders on continuous use; (d) accountability/audit; (e) note private right of action → rigorous logging.
- **Self-harm protocol flow**: detect (flags + LLM) → intervene (supportive message + crisis resources) → suppress harmful generation → log `CrisisEvent`.
- **Age verification**: baseline self-declared gate at entry; escalate to vendor verification for mature access per jurisdiction. Vendor behind `AgeVerificationProvider` interface.
- **Jurisdiction gating**: mature content availability keyed to region; capture jurisdiction at signup.
- **Data privacy (GDPR/CCPA)**: intimate-data handling, export + delete, consent for analytics (EU), minimal retention.
- **Payment constraints**: mature content excludes Stripe/PayPal; use adult-friendly processors behind the `PaymentProvider` abstraction.
- **Content moderation**: user-created public characters pass moderation before publish.

---

## 13. Monetization

| Tier | Price (indicative) | Chat | Memory depth | Voice | Image | Tokens |
|---|---|---|---|---|---|---|
| Free | $0 | limited/day | shallow | ✗ | ✗ | trickle grant |
| Premium | ~$12–20/mo | unlimited | full | included quota | image credits | monthly grant |
| Pro | ~$30–50/mo | unlimited, premium model | full + priority | higher quota | higher quota | larger grant |

- **Token economy**: images, voice clips, and premium-model messages consume credits; credits sold in packs and granted per tier.
- **Processor strategy**: adult-friendly processor primary, crypto optional; normalized webhooks.

---

## 14. Infrastructure & deployment (AWS, mirrors Pellow)

- **Frontend**: AWS Amplify (Next.js 16 SSR/WEB_COMPUTE), CloudFront + Route 53.
- **Backend + WS + worker**: ECS Fargate (cluster e.g. `poppy-prod`), ALB with WS support; separate task or same task for BullMQ worker.
- **DB**: RDS Postgres + pgvector, connection pooling (`pgbouncer=true&connect_timeout=15`).
- **Cache/queue**: ElastiCache Redis. **Storage**: S3 (media) behind CloudFront signed URLs.
- **Docker**: multistage (Node 20-slim, non-root uid 10001, tini PID 1, ffmpeg for voice, openssl for Prisma).
- **Env catalog**: mirror `../Pellow/.env.example` structure — DB, JWT_SECRET, OPENROUTER_API_KEY, ANTHROPIC/OPENAI keys, ELEVENLABS/CARTESIA keys, FAL/REPLICATE keys, payment processor keys, S3/AWS creds, REDIS_URL, age-verification vendor keys, SENTRY_DSN, feature flags.
- **CI**: typecheck + lint + Vitest + Playwright on PR; build images; **deploys gated on explicit human approval** (see global rule).

---

## 15. Security
- httpOnly Secure SameSite cookies; audience-scoped JWT (`jose`); timing-safe token comparison; short-TTL magic links (SHA-256 hashed at rest).
- Server-side Zod validation on every mutation; `assertSafeString`/`assertSafeId` guards.
- Rate limiting per user/IP on REST + WS; abuse/spam prevention on generation endpoints.
- Least-privilege IAM; secrets in SSM/Secrets Manager (writes to non-local secrets require explicit approval).
- CSP/HSTS/X-Frame-Options headers (Pellow `next.config` pattern).

## 16. Analytics & observability
- Event taxonomy: signup, age_verified, chat_started, message_sent, memory_written, voice_generated, image_generated, subscribe, token_purchase, crisis_event, character_created/published.
- Sentry for errors; metric counters (LLM provider outcomes, media job outcomes, latency) mirroring Pellow `metrics.ts`.

---

## 17. Phased roadmap → traceability

| Phase | Cursor prompt file | PRD sections covered |
|---|---|---|
| Foundation / scaffolding | `00-foundation.md` | 7.1, 14 |
| Auth & age gate | `01-auth-age-gate.md` | 5.1, 12, 15 |
| Data model | `02-data-model.md` | 8 |
| Character gallery | `03-character-gallery.md` | 5.2 |
| Chat streaming | `04-chat-streaming.md` | 5.3, 7.2(1), 9.2, 10 |
| Memory RAG | `05-memory-rag.md` | 5.4, 10 |
| Creation wizard | `06-creation-wizard.md` | 5.7, 5.2 |
| Media queue | `07-media-queue.md` | 7.2(2), 11 |
| Voice TTS | `08-voice-tts.md` | 5.5, 11 |
| Image gen | `09-image-gen.md` | 5.6, 11 |
| Billing & tokens | `10-billing-tokens.md` | 5.8, 13 |
| Safety & compliance | `11-safety-compliance.md` | 5.9, 12 |
| Settings & observability | `12-settings-observability.md` | 5.10, 16 |
| Deploy (AWS) | `13-deploy-aws.md` | 14 |

Every functional-requirement domain maps to ≥1 phase file. ✔

---

## 18. Risks & open questions
- **Uncensored model hosting legality** by jurisdiction; OpenRouter model availability/ToS.
- **Payment processor onboarding** for mature content (KYC, higher fees, chargeback risk).
- **Image-gen cost & consistency** — self-hosted SDXL/Flux GPU cost vs Fal/Replicate API margins; LoRA training pipeline vs IP-Adapter zero-shot.
- **Age-verification UX friction** vs conversion; vendor cost per check.
- **SB 243 exposure** — continuous compliance and logging discipline given the private right of action.
- **WebSocket scale-out** on ECS/ALB — sticky sessions vs Redis pub/sub fan-out.

---

*End of Master PRD v1.0.*
