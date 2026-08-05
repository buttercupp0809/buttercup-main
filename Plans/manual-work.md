# Poppy: end-to-end sanity results and remaining manual work

Generated: 2026-07-30
Scope: after phases 00 through 13 (deploy prep) were scaffolded.

## 1. Sanity run summary

| Check | Command | Result |
|---|---|---|
| Typecheck (all workspaces) | `npm run typecheck` | PASS |
| Lint | `npm run lint` | FAIL (4 errors, 9 warnings) — see §2.1 |
| No em dashes | `npm run check:no-em-dash` | PASS |
| Unit + integration tests (Vitest) | `npm test` | PASS (180/180 in 26 files) |
| Build (frontend + backend + packages) | `npm run build` | PASS |
| Prisma migrations present | `ls packages/database/prisma/migrations` | PASS (4 migrations + lock) |
| `.env` present with placeholders | `test -f .env` | PASS (all vendor keys empty) |
| Local Postgres reachable | `psql ...` | FAIL — Postgres not running |
| Local Redis reachable | `redis-cli ping` | FAIL — Redis not running |
| Docker installed | `docker --version` | PASS (29.4.0) |
| Docker compose smoke boot | `docker compose up` | NOT RUN (blocked by no local infra config choice, see §3.1) |
| Playwright E2E | `npm run test:e2e` | NOT RUN (specs stubbed / skipped) |
| Live LLM streaming | curl against `/api/chat/stream` | NOT RUN (no real API key) |
| ECR push / ECS roll / Amplify deploy | `infra/DEPLOY.md` | NOT RUN (guardrailed) |

Overall: **code compiles, tests are green, deploy artifacts are in place. Nothing has been deployed or pushed anywhere.**

## 2. Blockers to fix in code (small, safe)

### 2.1 Lint errors: 4 undefined-rule references (~10 min)

The flat ESLint config does not register the `@next/next` and `react-hooks` plugins, but four files use inline `eslint-disable-next-line` comments that reference rules from those plugins. ESLint 9 treats an unknown rule in a disable comment as an error.

Files:
- `frontend/app/(protected)/dashboard/page.tsx:39` — `@next/next/no-img-element`
- `frontend/app/(public)/characters/[id]/page.tsx:35` — `@next/next/no-img-element`
- `frontend/components/gallery/CharacterCard.tsx:20` — `@next/next/no-img-element`
- `frontend/components/gallery/GalleryToolbar.tsx:44` — `react-hooks/exhaustive-deps`

Two fixes, either works:
- **A (recommended)**: register the plugins in `eslint.config.mjs` (`@next/eslint-plugin-next`, `eslint-plugin-react-hooks`).
- **B (fast)**: delete the four disable comments; the linter is not warning about those constructs today.

Also nine warnings for unused `eslint-disable @typescript-eslint/no-require-imports` directives across `backend/src/llm/provider.ts`, `backend/src/media/storage.ts`, `backend/src/queue/*.ts`. Safe to delete those disable comments.

### 2.2 Unused import warning (~30 sec)

`frontend/app/api/characters/route.ts:12` imports `moderateCharacter` but never uses it. Remove the symbol from the import list.

## 3. Manual work you (human) must do

These are things Cursor deliberately did not do because they need real secrets, live infrastructure, or explicit approval.

### 3.1 Local dev prerequisites (before running the app locally)

You need Postgres 16 with `pgvector` and Redis 7. Two options:

**Option A: Docker compose (recommended)**
```bash
docker compose up -d postgres redis
# then in another shell:
DATABASE_URL="postgresql://poppy:poppy@localhost:5432/poppy_dev?schema=public" \
  npm run db:migrate
npm run db:seed
npm run dev:backend    # PORT 4000
npm run dev:frontend   # PORT 3000
```

**Option B: Local Postgres via Homebrew** (the `.env` already points here)
```bash
brew install postgresql@16 pgvector redis
brew services start postgresql@16
brew services start redis
createuser -s poppy
createdb -O poppy poppy_dev
createdb -O poppy poppy_test
psql -d poppy_dev -c 'CREATE EXTENSION IF NOT EXISTS vector;'
psql -d poppy_test -c 'CREATE EXTENSION IF NOT EXISTS vector;'
npm run db:migrate
npm run db:seed
```

Right now `psql` and `redis-cli` both fail on localhost, so neither is running. Pick one and run it.

### 3.2 Populate `.env` vendor keys

Every vendor key in `.env` is currently an empty string. The app boots (fallbacks + stubs), but the following features stay in mock mode until a real key is present. Add them to `.env` locally and to Amplify / Secrets Manager for deploy.

| Feature | Env vars needed | Where to get it |
|---|---|---|
| LLM chat (Uncensored primary) | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| LLM chat (Anthropic fallback) | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| LLM chat (OpenAI fallback) | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| Voice (primary) | `ELEVENLABS_API_KEY` | https://elevenlabs.io/app/settings/api-keys |
| Voice (fallback) | `CARTESIA_API_KEY` | https://play.cartesia.ai |
| Voice (last-resort) | `GOOGLE_TTS_API_KEY` | GCP console |
| Image gen (primary) | `FAL_KEY` | https://fal.ai/dashboard/keys |
| Image gen (fallback) | `REPLICATE_API_TOKEN` | https://replicate.com/account/api-tokens |
| Payments (CCBill) | `CCBILL_ACCOUNT_NUMBER`, `CCBILL_FLEXFORM_ID`, `CCBILL_DATALINK_SALT` | CCBill merchant portal (adult-approved merchant account required) |
| Payments (Verotel) | `VEROTEL_SHOP_ID`, `VEROTEL_SIGNATURE_KEY` | Verotel merchant onboarding |
| Payments (SegPay) | `SEGPAY_PACKAGE_ID`, `SEGPAY_URL_ID`, `SEGPAY_HMAC_KEY` | SegPay merchant onboarding |
| Age verification (real vendor) | `AGE_VERIFICATION_VENDOR_KEY` | Yoti / Persona / Jumio contract |
| Observability | `SENTRY_DSN` | Sentry project settings |
| S3 media | `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (local) or IAM role (ECS) | AWS console |
| CloudFront signed URLs | `CLOUDFRONT_URL`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` | CloudFront distribution + trusted key group |

**Rule:** never commit any of the above. `.env` is git-ignored; only `.env.example` (placeholders) is tracked.

### 3.3 Vendor accounts and business setup

These are external to code and take real calendar time:

- **Adult-friendly payment processor onboarding** (CCBill / Verotel / SegPay). Standard processors (Stripe, PayPal) are blocked at compile time in `backend/src/payments/types.ts` because the app allows mature content. Onboarding typically requires: business docs, chargeback history, adult-content statement of use, ID verification, sometimes a security deposit. Budget 2–4 weeks.
- **Age-verification vendor** (Yoti, Persona, Jumio, or Veriff). Required for jurisdictions in `backend/src/safety/jurisdiction.ts` `RESTRICTED_MATURE_REGIONS`. The `VendorProvider` in `frontend/lib/age-verification/provider.ts` is a stub; wire it to the vendor SDK once selected.
- **Terms of Service + Privacy Policy** covering: adult content, AI-companion disclosure (SB 243), data retention, deletion rights (GDPR/CCPA), payment terms, and jurisdiction. Cursor can draft; a lawyer must review.
- **SB 243 compliance sign-off** (California AI Companion Law). The code implements: crisis detection before generation (`backend/src/safety/sb243-protocol.ts`), persistent AI disclosure (`frontend/components/ai-disclosure.tsx`), and audit logging. Legal review of the intervention copy and the disclosure wording is required.
- **DMCA agent registration** with the U.S. Copyright Office (~$6, annual).
- **Hosting jurisdiction decision** for mature content (which AWS region, which country of incorporation).

### 3.4 AWS provisioning (one-time, per environment)

Follow `infra/README.md` for the topology. Every step is human-executed:

1. Create the RDS Postgres 16 instance. Attach a parameter group with `vector` in `shared_preload_libraries`. Run `CREATE EXTENSION vector;` once. Enable RDS Proxy or run pgbouncer.
2. Create the ElastiCache Redis (single primary + 1 replica is enough).
3. Create the private S3 bucket + CloudFront distribution with a trusted key group and OAC. Save the key pair; put the private key into Secrets Manager.
4. Register the Route 53 hosted zone. Add `poppy.app`, `api.poppy.app`, `media.poppy.app`.
5. Create the ACM certificates (us-east-1 for CloudFront, target region for the ALB).
6. Create the ECS cluster `poppy-prod`, the ALB with an HTTPS listener (stickiness + 300s idle timeout), and the target groups.
7. Populate Secrets Manager entries at `poppy/<VAR>` for every ECS row in `infra/env-catalog.md`. Grant the `poppy-ecs-execution` role `secretsmanager:GetSecretValue` on `poppy/*`.
8. Populate the Amplify console env for the production branch with every "Amplify" row in `infra/env-catalog.md`.
9. Create the ECR repository `poppy`.
10. Push the first image (see `infra/DEPLOY.md` step 2 for the approval-gated commands).
11. Register the task definitions (`infra/ecs/task-*.json`) and create the services (`infra/ecs/service-*.json`).

**Every one of the above is gated on explicit human approval per the project guardrail.**

### 3.5 First deploy

Follow `infra/DEPLOY.md` step-by-step, stopping for approval at each **STOP AND GET APPROVAL** banner. Order matters:

1. Migrate DB.
2. Build + push image to ECR.
3. Update ECS services (API first, then worker).
4. Trigger Amplify build (frontend last, so the browser never sees old-frontend vs new-backend).
5. Smoke check `/healthz` and a WS handshake.

### 3.6 CI enablement

`.github/workflows/ci.yml` runs typecheck / lint / unit tests (with Postgres+Redis service containers) / e2e (compose) / docker build on every PR. **The deploy job is commented out with `if: false`.** Do not enable it without a fresh explicit approval.

To turn CI on:
- Push the repo to GitHub.
- Enable Actions in the repo settings.
- Add branch protection on `main` requiring the CI checks to pass.

### 3.7 Playwright e2e specs

The Playwright specs in `e2e/*.spec.ts` are scaffolded but skipped. To enable:
- Seed the local dev DB (`npm run db:seed`).
- Start both frontend and backend.
- Un-`.skip` the specs and fill in the assertions against the seeded data.
- Add a CI-only DB seed step in `.github/workflows/ci.yml` before the `test-e2e` job.

### 3.8 Optional follow-ups (nice to have, not blocking)

- **Sentry wiring**: `SENTRY_DSN` env is defined but `next.config.ts` does not yet wrap with `withSentryConfig`, and no `/api/_debug/throw` route exists. ~1 hour of work.
- **ElevenLabs WS pre-warm pool**: current implementation uses batch HTTP. WebSocket streaming gets you sub-500ms TTFA. See `backend/src/media/voice/generate.ts`.
- **Real gallery selfie page**: `frontend/app/api/characters/[id]/gallery/route.ts` exposes the data; the UI page still needs to be built.
- **Prisma config migration**: warning in the build says `package.json#prisma` is deprecated in Prisma 7. Move to `prisma.config.ts` when we upgrade.
- **Load test on WS + BullMQ**: nothing has run under load; do a k6 or Artillery run against the compose stack before opening to real users.

## 4. What you should NOT do

- Do not enable the `deploy` job in `.github/workflows/ci.yml` without a fresh explicit approval.
- Do not run `prisma migrate deploy` against any non-local DB without a fresh explicit approval (see `infra/DEPLOY.md` step 1).
- Do not `docker push` without approval (see `infra/DEPLOY.md` step 2).
- Do not put real secrets in `.env.example` or in any file that gets committed. `.env` is git-ignored; keep it that way.
- Do not add Stripe or PayPal integrations. `backend/src/payments/types.ts` blocks them at compile time because the app allows mature content, and adding them would violate their terms of service and put your merchant accounts at risk.

## 5. Green-light checklist

Before you go live:
- [ ] Local dev works end-to-end: signup -> age gate -> pick character -> chat -> voice note -> image gen -> subscribe.
- [ ] All lint errors in §2 fixed.
- [ ] All vendor keys in §3.2 populated in the production environment.
- [ ] Adult payment processor account approved and webhooks pointing at `https://api.poppy.app/webhooks/{ccbill|verotel|segpay}`.
- [ ] Age vendor account wired into `frontend/lib/age-verification/provider.ts`.
- [ ] Legal review of ToS, Privacy Policy, SB 243 disclosure copy, and crisis intervention copy.
- [ ] AWS provisioning complete per §3.4.
- [ ] First `infra/DEPLOY.md` run green, including WS smoke check.
- [ ] Sentry receiving events; a test error surfaces in the dashboard.
- [ ] Load test showing headroom at 3x expected concurrent WS + BullMQ throughput.
- [ ] Runbook for on-call: what to do if LLM providers all fail, if RDS goes into failover, if a payment webhook is delayed, if a crisis intervention fires (SB 243 audit obligation).
