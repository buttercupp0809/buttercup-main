# Phase 13: Deployment (AWS, mirrors Pellow)

> **READ THIS FIRST. DEPLOY REQUIRES EXPLICIT HUMAN APPROVAL.**
> This file describes how to **prepare** ButterCupp's infrastructure and CI. It does **not** authorize any deploy. Every actual push, image publish, `terraform apply`/console change against non-local infrastructure, and every migration against a non-local database is **GATED on a fresh, explicit, per-action human approval**. Cursor must **prepare artifacts and STOP** at every deploy boundary and ask. Silence is not approval. A previous approval does not carry to the next action.

## Goal
Prepare (not execute) the AWS infrastructure and CI to ship ButterCupp, mirroring Pellow:
- **Amplify** for the Next.js 16 frontend (SSR / `WEB_COMPUTE`), mirroring Pellow `amplify.yml`.
- **ECS Fargate** for the backend API + WebSocket gateway + BullMQ worker, behind an **ALB with WebSocket + sticky-session support**.
- **RDS Postgres + pgvector** with pooling (`pgbouncer=true&connect_timeout=15`).
- **ElastiCache Redis** for queue + presence.
- **S3 + CloudFront** (signed URLs) for media.
- **Route 53** DNS.
- **Multistage Dockerfile** finalize (Node 20-slim, non-root uid 10001, tini PID 1, ffmpeg, openssl).
- **Env var wiring** across Amplify + ECS, mirroring the `.env.example` catalog.
- **CI pipeline**: typecheck + lint + Vitest + Playwright + build images, that **STOPS before deploy**.

Reference: PRD §14 (infra), §15 (security), §7 (architecture), §7.2 (WS gateway + async media queue).

## Prerequisites
- Phases 00 through 12 green locally: full app builds, all tests pass, `.env.example` catalog complete (phase 00), Dockerfile scaffolded (phase 00), health endpoint `GET /healthz` (phase 12) present.
- AWS account access exists but is **not** to be mutated by Cursor. All AWS CLI/console/IaC changes are human-executed after approval.
- `packages/database` Prisma singleton `@buttercupp/database`.

## Context to paste into Cursor
> Build Phase 13 (Deployment prep) for ButterCupp per Master PRD §14. Mirror Pellow's deploy topology. **Produce config and scripts only. Do not run any deploy, push, image publish, or non-local migration. Stop and ask before every such action.**
>
> Pellow reference files to read and mirror (in `../Pellow`):
> - `Dockerfile`: multistage: stage 1 `node:20-slim` builder (openssl, python3/make/g++, libvips-dev; `prisma generate` + `tsc`; `npm prune --production`); stage 2 runtime (openssl, ffmpeg, tini, ca-certificates), non-root user uid/gid 10001, `ENTRYPOINT ["/usr/bin/tini","--"]`, `STOPSIGNAL SIGTERM`. Mirror exactly; add BullMQ worker start path.
> - `amplify.yml`: `appRoot: frontend`, preBuild symlinks `@buttercupp/database` into `node_modules`, copies Prisma client/adapter-pg, builds with `next build --webpack` (not Turbopack, because Turbopack auto-externalizes native `.node` binaries), and injects server env vars into `.next/server-env.json`. Mirror the structure; swap the env catalog to ButterCupp's.
> - `frontend/next.config.ts`: security headers already added in phase 12; confirm they ship.
>
> Locked decisions (PRD §0): AWS (Amplify + ECS Fargate + RDS + pgvector + Redis + S3 + CloudFront), mature-gated. No em dashes anywhere.
>
> HARD RULE: no commit, push, deploy, image publish, or non-local migration without a fresh explicit human approval. Write every deploy step as "prepare, then STOP for approval", never as auto-run.

## Build steps

### 1. Finalize the Dockerfile: `/Dockerfile`
- Mirror Pellow's two stages. Runtime deps: `openssl ffmpeg ca-certificates tini`. Non-root `app` uid/gid 10001. `tini` as PID 1. `STOPSIGNAL SIGTERM`.
- ButterCupp runs three roles from one image; select at runtime via `PROCESS_ROLE` env (`api` | `worker`): `CMD` defaults to the API+WS server (`node dist/index.js`); the worker task overrides the command to `node dist/worker.js` (BullMQ). Document this in a comment.
- `.dockerignore`: exclude `node_modules`, `.next`, `.git`, `*.test.ts`, e2e artifacts.

### 2. Docker Compose smoke stack: `/docker-compose.yml`
- Services: `postgres` (with pgvector image), `redis`, `backend` (built from the Dockerfile, `PROCESS_ROLE=api`), `worker` (`PROCESS_ROLE=worker`). Local-only. Used by the CI smoke test and local dev of the full stack.
- Include a healthcheck on each service; backend healthcheck hits `GET /healthz`.

### 3. Amplify config: `/amplify.yml`
- Mirror Pellow: `appRoot: frontend`, preBuild symlinks `@buttercupp/database`, copies the Prisma client + `adapter-pg` + transitive deps, `next build --webpack`, and injects `.next/server-env.json`.
- Replace Pellow's env block with ButterCupp's catalog (see step 6). Keep the webpack (not Turbopack) note as a comment explaining why.

### 4. ECS task definitions: `/infra/ecs/`
- `task-api.json`: API + WebSocket gateway task (`PROCESS_ROLE=api`), port 4000, health check on `/healthz`, secrets pulled from SSM/Secrets Manager (referenced by ARN, **never inlined**).
- `task-worker.json`: BullMQ worker task (`PROCESS_ROLE=worker`), no inbound port, same image.
- `service-api.json`: ALB target group with **stickiness enabled** and the listener configured for **WebSocket upgrade** (idle timeout raised, e.g. 300s); desired count >= 2 for HA behind the ALB.
- Document (comment) the WS scale-out choice: sticky sessions at the ALB plus Redis pub/sub fan-out for cross-node delivery (PRD §18 open question).

### 5. IaC / infra notes: `/infra/README.md`
- Describe (do not create resources) the RDS Postgres + pgvector instance (parameter group enabling the `vector` extension, connection string with `pgbouncer=true&connect_timeout=15`), ElastiCache Redis, S3 media bucket + CloudFront distribution with **signed URLs**, Route 53 records, and the ECS cluster `buttercupp-prod`.
- Each subsection ends with: "Provisioning is a human-approved step. Do not run apply/create."

### 6. Env catalog wiring: `/.env.example` (confirm) + `/infra/env-catalog.md`
- Confirm `.env.example` (phase 00) covers: `DATABASE_URL` (with pooling params), `JWT_SECRET`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`/`CARTESIA_API_KEY`, `FAL_API_KEY`/`REPLICATE_API_TOKEN`, adult-friendly payment processor keys (e.g. `CCBILL_*`/`SEGPAY_*`/`VEROTEL_*`), `AWS_*` + `S3_BUCKET` + `CLOUDFRONT_KEY_PAIR_ID`/`CLOUDFRONT_PRIVATE_KEY`, `REDIS_URL`, age-verification vendor keys, `SENTRY_DSN`, and feature flags.
- `/infra/env-catalog.md` maps each var to its home: **Amplify env** (frontend/SSR) vs **ECS task secret** (backend/worker). Mark which are `NEXT_PUBLIC_*`. Note: writing these into Amplify/ECS/SSM is a **human-approved** action; the file only documents the mapping.

### 7. CI pipeline (build only, stops before deploy): `/.github/workflows/ci.yml`
- Triggers on PR + push to non-main branches. Jobs, in order: `install` → `typecheck` (`tsc --noEmit` across workspaces) → `lint` → `test-unit` (Vitest) → `test-e2e` (Playwright, against the compose stack) → `build-images` (`docker build`, tag locally; **do not push**).
- The workflow **ends after build**. Add a commented-out, manual-approval-gated `deploy` job stub with a bold comment: "DO NOT enable without explicit human approval per project guardrail."
- No registry login, no `docker push`, no `amplify`/`ecs`/`aws deploy` steps.

### 8. Deploy runbook (documentation, not automation): `/infra/DEPLOY.md`
- Step-by-step human runbook: (1) migrate DB [STOP: approval], (2) build + push images to ECR [STOP: approval], (3) update ECS services [STOP: approval], (4) trigger Amplify build [STOP: approval], (5) smoke-check health + WS.
- Every step is prefixed with a **STOP AND GET APPROVAL** banner. No script auto-runs the chain. If a `deploy.sh` is written, it must `echo` the steps and exit 1 unless an explicit `--i-have-approval` flag plus a fresh confirmation is passed; document that even then a human runs it, not Cursor.

## Test instructions
Local only (no deploy):
- `docker build -t buttercupp:local .`: image builds clean (multistage, non-root).
- `docker compose -f docker-compose.yml up --build -d` then `curl -sf http://localhost:4000/healthz`: backend + redis + postgres smoke test passes; worker connects to Redis.
- `npx tsc --noEmit` across workspaces, `npm run lint`, `npm run test` (Vitest), `npx playwright test`: CI steps run green locally.
- Config validation: `aws ecs register-task-definition --cli-input-json file://infra/ecs/task-api.json --generate-cli-skeleton` style dry-run / a JSON schema lint on the task defs, and `yamllint amplify.yml .github/workflows/ci.yml`. Validation only, no registration.

## Sanity checklist
- [ ] **DEPLOY REQUIRES EXPLICIT APPROVAL** is stated prominently (top of this file + `DEPLOY.md` + CI deploy stub).
- [ ] No secret is committed: task defs reference SSM/Secrets Manager ARNs; `.env` is gitignored; only `.env.example` has placeholder values.
- [ ] WebSocket works through the ALB config: stickiness on, upgrade + raised idle timeout set in `service-api.json`.
- [ ] Health checks pass: `/healthz` green in the compose smoke test and referenced by the ECS/ALB health check.
- [ ] Dockerfile runs non-root (uid 10001), tini PID 1, ffmpeg present.
- [ ] CI ends after `build-images`; no push/deploy step is active.
- [ ] RDS connection string carries `pgbouncer=true&connect_timeout=15`.

## Done criteria
`docker build` and the compose smoke test succeed locally; CI runs green locally through image build and stops; task defs + `amplify.yml` + workflow YAML validate; no secrets committed; the approval-gate language is present everywhere a deploy could be triggered. Nothing has been deployed, pushed, or migrated against non-local infra.

## Guardrail note
This is the deploy-prep phase, so the guardrail is at its strongest. **No commit, no push, no image publish, no `terraform apply`/console mutation, no Amplify/ECS deploy, and no migration against any non-local database happens without a fresh, explicit, per-action human approval.** Prepare artifacts, summarize, and STOP for approval at every boundary. A prior approval never carries forward. When unsure whether an action touches non-local infrastructure, assume it does and ask.
