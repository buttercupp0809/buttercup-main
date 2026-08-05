# Phase 00: Foundation & scaffolding

## Goal
Stand up the ButterCupp monorepo skeleton that every later phase builds on: an npm-workspaces monorepo mirroring Pellow (`frontend/`, `backend/`, `packages/database`, `packages/shared`), the `@buttercupp/database` Prisma 6 + Postgres + pgvector singleton, shared tooling (TypeScript strict, ESLint, Prettier, Vitest, Playwright), a multistage production Dockerfile, a complete `.env.example`, a root `CLAUDE.md` documenting conventions, and a `.cursor/skills/buttercupp-design-language/SKILL.md` stub. After this phase `npm install`, `npm run typecheck`, `npm run build`, and `docker build` all succeed locally, and `import { prisma } from "@buttercupp/database"` resolves from both `frontend/` and `backend/`.

No product features yet. This phase only delivers the scaffold, the singleton, and the tooling that the locked decisions (PRD §0) and inherited conventions (PRD §7.1) require.

## Prerequisites
- Node 20.x and npm 10.x installed locally.
- Docker Desktop running (for the `docker build` sanity check).
- A local Postgres 16 with the `vector` extension available (Postgres.app, Homebrew `postgresql@16` + `pgvector`, or `docker run pgvector/pgvector:pg16`). Needed only to confirm the pgvector extension enables; no schema is created in this phase.
- Read the Master PRD sections referenced below before starting.

## Context to paste into Cursor
Paste this block into the Cursor agent verbatim, then let it implement the Build steps.

```
You are scaffolding "ButterCupp", a mature-gated AI companion platform. This is Phase 00 (foundation only, no product features).

Authoritative spec: prds/master-prd.md. Read these sections:
- §0  Locked decisions (mature from day 1, AWS infra, all four hard capabilities in MVP, web-first PWA). Do NOT reintroduce SFW-only, Vercel/Neon, or native-first assumptions.
- §7.1 Inherited-from-Pellow conventions (reused verbatim).
- §7.2 Deliberate divergences (WebSocket gateway, BullMQ media queue, multi-character model, mature gating, token economy), do not build them now, but lay out folders that will host them.
- §14 Infrastructure & deployment (AWS: Amplify + ECS Fargate + RDS Postgres + pgvector + ElastiCache Redis + S3 + CloudFront; multistage Docker Node 20-slim non-root).

Mirror the Pellow reference repo at ../Pellow for every convention. Concrete reference paths:
- Root workspaces: ../Pellow/package.json (workspaces = ["frontend","backend","packages/*"]; scripts: typecheck, build, db:generate/push/migrate/studio via workspace; postinstall runs db:generate).
- Prisma singleton: ../Pellow/packages/database/src/client.ts and src/index.ts. The singleton uses globalThis caching + PrismaPg adapter + pool-param injection (connection_limit, pgbouncer=true, connect_timeout, pool_timeout). Export prisma from a package named "@buttercupp/database" (Pellow uses "@karoli/database"). NEVER call `new PrismaClient()` anywhere except inside packages/database/src/client.ts.
- Dockerfile: ../Pellow/Dockerfile (multistage; builder installs openssl/python3/make/g++/libvips-dev; runtime is node:20-slim with openssl + ffmpeg + tini + ca-certificates, non-root user uid 10001, tini as ENTRYPOINT).
- Env catalog: ../Pellow/.env.example structure (adapt vars to ButterCupp, see Build steps).
- Utils to port shape-for-shape later: ../Pellow/backend/src/utils/{retry.ts,safe-types.ts,audit.ts} and ../Pellow/backend/src/config/flags.ts. In this phase create thin stubs of retry.ts, safe-types.ts, and flags.ts so later phases have the home; audit.ts depends on the DB schema so leave it for Phase 02.

Hard rules:
- TypeScript strict everywhere. No em dashes in code, comments, or docs (use commas, periods, parentheses).
- Frontend = Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui.
- Backend = plain Node.js + TypeScript server (will host REST helpers, the WebSocket gateway, and the BullMQ worker in later phases).
- packages/shared = shared TypeScript types + Zod schemas, importable as "@buttercupp/shared".
- packages/database = Prisma 6 + Postgres + pgvector, exported as "@buttercupp/database".
- Do NOT run git commit, git push, any deploy, or any migration against a non-local database. Local-only commands only.
```

## Build steps
Create files and folders exactly as listed. Names are concrete on purpose.

### 1. Root workspace config
- `package.json`. private root. `"workspaces": ["frontend","backend","packages/*"]`. Scripts (mirror `../Pellow/package.json`, rename to `@buttercupp/*`):
  - `"typecheck": "(cd packages/database && npx tsc --noEmit) && (cd packages/shared && npx tsc --noEmit) && (cd backend && npx tsc --noEmit)"`
  - `"build": "npm run build --workspaces --if-present"`
  - `"postinstall": "npm run db:generate"`
  - `"db:generate": "npm run generate --workspace=@buttercupp/database"`
  - `"db:push": "npm run push --workspace=@buttercupp/database"`
  - `"db:migrate": "npm run migrate --workspace=@buttercupp/database"`
  - `"db:studio": "npm run studio --workspace=@buttercupp/database"`
  - `"dev:frontend": "npm run dev --workspace=frontend"`
  - `"dev:backend": "npm run dev --workspace=backend"`
  - `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"lint": "eslint ."`
- `tsconfig.json` (root base), strict true, `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `paths` mapping `@buttercupp/database` and `@buttercupp/shared` to their `src`. Each workspace `tsconfig.json` extends this.
- `.gitignore`. `node_modules`, `.next`, `dist`, `.env`, `.env.local`, `coverage`, `playwright-report`, `test-results`, `.cache`, `*.tsbuildinfo`.
- `.eslintrc.cjs` (or `eslint.config.mjs` flat config), TypeScript + React + Next rules, and a custom no-em-dash guard (a `no-restricted-syntax`/regex lint that flags the em dash character in source and comments).
- `.prettierrc`. 2-space, double quotes, trailing commas, `printWidth 100`.
- `vitest.config.ts` (root), node + jsdom projects; `test.include` covers `**/*.test.ts` and `**/*.test.tsx`; sets up a `packages/**` and `backend/**` node environment plus a `frontend/**` jsdom environment.
- `playwright.config.ts` (root), `testDir: "e2e"`, `baseURL: http://localhost:3000`, a `webServer` that runs `npm run dev:frontend`, chromium project.
- `e2e/.gitkeep`. placeholder so the Playwright dir exists.

### 2. `packages/database` (the `@buttercupp/database` singleton)
- `packages/database/package.json`. name `@buttercupp/database`, `main: ./dist/index.js`, `types: ./dist/index.d.ts`. Scripts: `generate` (`prisma generate`), `push` (`prisma db push`), `migrate` (`prisma migrate dev`), `studio` (`prisma studio`), `build` (`prisma generate && npx tsc`). Deps: `@prisma/client ^6`, `@prisma/adapter-pg ^6`, `pg ^8`. devDeps: `prisma ^6`, `@types/pg`, `typescript`.
- `packages/database/prisma/schema.prisma`. in this phase a MINIMAL schema so the client generates: the `generator client` block (previewFeatures `["driverAdapters"]`, `binaryTargets ["native","rhel-openssl-3.0.x","linux-arm64-openssl-3.0.x"]`), the `datasource db` block (`provider postgresql`, `url env("DATABASE_URL")`), and a single throwaway `HealthCheck` model with an `id` and `createdAt` so `prisma generate` has something to emit. The full model set lands in Phase 02.
- `packages/database/prisma/migrations/.gitkeep`. placeholder for the migrations dir.
- `packages/database/src/client.ts`. port `../Pellow/packages/database/src/client.ts` verbatim in shape: `globalForPrisma` globalThis cache, `isServerless` detection, `getDbUrl()` param injection (`connection_limit=20`, `pgbouncer=true`, `connect_timeout=15`, `pool_timeout=30` for non-serverless), `createPrismaClient()` using `PrismaPg`, `export const prisma = globalForPrisma.prisma ?? createPrismaClient()`, cache on globalThis only when `NODE_ENV !== "production"`. This is the ONLY file allowed to call `new PrismaClient()`.
- `packages/database/src/types.ts`. re-export helpful Prisma enums/types (empty-ish stub now; grows in Phase 02).
- `packages/database/src/index.ts`. `export { prisma } from "./client";` plus `export * from "@prisma/client";` and `export * from "./types";` (mirror Pellow index.ts).
- `packages/database/tsconfig.json`. extends root; `outDir dist`, `rootDir src`.
- Add a local SQL helper note: document that pgvector is enabled with `CREATE EXTENSION IF NOT EXISTS vector;` (executed against the local DB in Phase 02, not now).

### 3. `packages/shared` (the `@buttercupp/shared` types + Zod schemas)
- `packages/shared/package.json`. name `@buttercupp/shared`, `main: ./dist/index.js`, `types: ./dist/index.d.ts`, `build: tsc`. Dep: `zod ^3`.
- `packages/shared/src/index.ts`. barrel export.
- `packages/shared/src/env.ts`. a Zod schema `envSchema` that will validate the runtime env (start with `DATABASE_URL`, `JWT_SECRET`; later phases extend). Export a `parseEnv()` helper.
- `packages/shared/src/types.ts`. placeholder shared enums (`SubscriptionTier`, `ContentRating`, `Visibility`) as string-literal unions, so frontend and backend agree. These get mirrored to Prisma enums in Phase 02.
- `packages/shared/tsconfig.json`. extends root.

### 4. `frontend/` (Next.js 16 App Router)
- Scaffold with the App Router, React 19, Tailwind 4, TypeScript. `frontend/package.json` depends on `next ^16`, `react ^19`, `react-dom ^19`, `@buttercupp/database`, `@buttercupp/shared`, `jose`, `zod`, `tailwindcss ^4`. Script `dev`, `build`, `start`, `lint`.
- `frontend/app/layout.tsx`, `frontend/app/page.tsx`. a placeholder landing page that renders "ButterCupp" so the dev server and Playwright have a target.
- `frontend/app/globals.css`. Tailwind 4 import plus a `:root` design-token block (CSS custom properties for color/spacing/type) referenced by the design skill. Keep tokens minimal now; the skill stub documents intent.
- `frontend/lib/db.ts`. `export { prisma } from "@buttercupp/database";` to prove the singleton import path works from the frontend workspace.
- `frontend/tsconfig.json`. extends root, `jsx preserve`, Next plugin, `paths` for `@/*`.
- `frontend/next.config.ts`. enable strict mode; add a `headers()` stub returning security headers (CSP/HSTS/X-Frame-Options placeholders per PRD §15, to be tightened later).
- Initialize shadcn/ui (`components.json`) and add one component (`button`) to prove the toolchain.

### 5. `backend/` (Node TS server: API helpers + future WS gateway + future worker)
- `backend/package.json`. name `@buttercupp/backend`, `main dist/index.js`. Deps: `@buttercupp/database`, `@buttercupp/shared`, `zod`, `ws`. Scripts: `dev` (`tsx watch src/index.ts` or `node --watch` via ts), `build` (`tsc`), `start` (`node dist/index.js`).
- `backend/src/index.ts`. a minimal HTTP server listening on `process.env.PORT ?? 4000` with a `GET /health` route returning `{ ok: true }`. Import `prisma` from `@buttercupp/database` (do not query yet) to prove the singleton resolves server-side.
- `backend/src/config/flags.ts`. port the `defaultOn(envVar)` pattern from `../Pellow/backend/src/config/flags.ts`. Seed one ButterCupp flag, e.g. `matureContentEnabled()` reading `MATURE_CONTENT_ENABLED` (default on), so later phases have the pattern.
- `backend/src/utils/retry.ts`. port `RETRY_PRESETS` shape from `../Pellow/backend/src/utils/retry.ts` (presets: `llm`, `database`, add `media` and `payment` placeholders).
- `backend/src/utils/safe-types.ts`. port `assertSafeId` and `assertSafeString` from `../Pellow/backend/src/utils/safe-types.ts` (runtime guards for Prisma `where` inputs).
- `backend/src/ws/.gitkeep`. folder for the Phase 04 WebSocket gateway.
- `backend/src/worker/.gitkeep`. folder for the Phase 07 BullMQ worker.
- `backend/tsconfig.json`. extends root, `outDir dist`.

### 6. Dockerfile (multistage, non-root)
- `Dockerfile` at repo root, port `../Pellow/Dockerfile`:
  - Stage 1 `builder` on `node:20-slim`: install `openssl python3 make g++ libvips-dev`; copy root + workspace `package.json`/`tsconfig.json` + `packages/database/prisma`; `npm install`; copy sources; `cd packages/database && npx prisma generate && npx tsc`; build shared and backend; `npm prune --production`.
  - Stage 2 runtime on `node:20-slim`: install `openssl ffmpeg ca-certificates tini`; create system user/group `app` uid/gid 10001; `ENV NODE_ENV=production PORT=4000`; `COPY --chown=app:app` node_modules + built packages; `USER app`; `ENTRYPOINT ["/usr/bin/tini","--"]`; `CMD ["node","dist/index.js"]`; `STOPSIGNAL SIGTERM`.
- `.dockerignore`. `node_modules`, `.next`, `dist`, `.env*`, `.git`, `coverage`, `playwright-report`.

### 7. `.env.example` (ButterCupp env catalog)
Create `.env.example` mirroring the structure of `../Pellow/.env.example` but with ButterCupp vars. Group with comments:
- Database: `DATABASE_URL="postgresql://user:password@localhost:5432/buttercupp?sslmode=disable"`
- Auth: `JWT_SECRET=` (note: min 32 chars / 32 bytes entropy, per Pellow getSecret hardening)
- LLM: `OPENROUTER_API_KEY=` (primary, uncensored), `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`
- Voice: `ELEVENLABS_API_KEY=`, `CARTESIA_API_KEY=`
- Image: `FAL_KEY=`, `REPLICATE_API_TOKEN=`
- Queue/cache: `REDIS_URL="redis://localhost:6379"`
- Storage: `S3_BUCKET=`, `S3_REGION=`, `AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`, `CLOUDFRONT_URL=`
- Payments (adult-friendly, NOT Stripe): `PAYMENT_PRIMARY_PROVIDER=ccbill`, `CCBILL_API_KEY=`, `CCBILL_WEBHOOK_SECRET=`, plus placeholders for `VEROTEL_*` / `SEGPAY_*`
- Age verification vendor: `AGE_VERIFICATION_PROVIDER=self_declared`, `AGE_VENDOR_API_KEY=`
- Observability: `SENTRY_DSN=`
- App: `NEXT_PUBLIC_APP_URL="http://localhost:3000"`, `PORT=4000`
- Feature flags: `MATURE_CONTENT_ENABLED=true`
Every secret value is blank or an obvious placeholder. Never commit a real secret.

### 8. Root `CLAUDE.md` (conventions doc)
Create `CLAUDE.md` at repo root documenting:
- Monorepo layout (`frontend/`, `backend/`, `packages/database`, `packages/shared`) and what each owns.
- The Prisma singleton rule, stated explicitly with the canonical import: `import { prisma } from "@buttercupp/database";`. Never `new PrismaClient()` outside `packages/database/src/client.ts`.
- No em dashes anywhere (code, comments, docs, commits). Use commas, periods, parentheses.
- TypeScript strict, Zod on every mutation, server-centric Next.js 16 App Router, minimal client state.
- The GUARDRAIL rule: never commit, push, migrate a non-local DB, or deploy without an explicit, fresh, per-action human approval.
- Where later phases live (link to `cursor-prompt/` and `prds/master-prd.md`).

### 9. `.cursor/skills/buttercupp-design-language/SKILL.md` (design system stub)
Create the stub (mirror the intent of `../Pellow/.cursor/skills/vesspr-design-language/SKILL.md`). Include: frontmatter (name, description of when to use it), a "sky + glass" style note placeholder, the CSS-var design tokens from `frontend/app/globals.css`, the reusable-component contract (reuse shared components, do not one-off styles), and hover/contrast/mobile rules. Mark it a stub to be filled in during UI phases.

## Test instructions
Run locally from the repo root:
```
# 1. Install + generate Prisma client (postinstall runs db:generate)
npm install

# 2. Type-check every workspace
npm run typecheck

# 3. Build every workspace
npm run build

# 4. Confirm the Prisma client generated
ls packages/database/node_modules/.prisma/client   # exists, or dist/ output present

# 5. Vitest smoke (add one trivial test: expect(1+1).toBe(2), plus a test importing { prisma } from "@buttercupp/database")
npm test

# 6. Build the production image locally (do NOT push)
docker build -t buttercupp:local .

# 7. (optional) confirm pgvector can enable on the local DB
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql "$DATABASE_URL" -c "\dx vector"
```

## Sanity checklist
- [ ] `npm install` completes and `postinstall` runs `db:generate` without error.
- [ ] `npm run typecheck` passes for `packages/database`, `packages/shared`, and `backend`.
- [ ] `npm run build` succeeds for all workspaces (`--if-present`).
- [ ] Workspaces resolve: `import { prisma } from "@buttercupp/database"` type-checks from BOTH `frontend/lib/db.ts` and `backend/src/index.ts`.
- [ ] `@buttercupp/shared` imports resolve from frontend and backend.
- [ ] Prisma client generates from the minimal schema; only `packages/database/src/client.ts` constructs `new PrismaClient()`.
- [ ] `docker build -t buttercupp:local .` succeeds; the final image runs as uid 10001 (non-root) with tini as PID 1.
- [ ] `.env.example` contains every ButterCupp var group (DB, JWT, OpenRouter/Anthropic/OpenAI, ElevenLabs/Cartesia, Fal/Replicate, Redis, S3/AWS, adult-friendly payment keys, age-vendor keys, Sentry) with no real secrets.
- [ ] Local pgvector extension enables (`\dx vector` lists it).
- [ ] `CLAUDE.md` states the singleton rule, the no-em-dash rule, and the guardrail rule.
- [ ] `.cursor/skills/buttercupp-design-language/SKILL.md` exists as a stub.
- [ ] No em dashes anywhere in the diff.

## Done criteria
The monorepo installs, type-checks, builds, and containerizes clean locally. The `@buttercupp/database` singleton is importable from frontend and backend, and no code outside the singleton constructs a Prisma client. `@buttercupp/shared` is wired. The Dockerfile produces a non-root Node 20 image with ffmpeg + tini + openssl. `.env.example`, `CLAUDE.md`, and the design-skill stub are in place. Phase 01 (auth + age gate) can start against this scaffold.

## Guardrail note
Stop and ask for explicit, fresh, per-action human approval before any `git commit`, `git push`, deploy (Amplify/ECS/anything), Docker push to a remote registry, or any migration against a non-local database. Local `npm install`, `npm run typecheck`, `npm run build`, `docker build` (no push), and `psql` against a LOCAL database are fine. When unsure whether an action is prod-touching, assume it is and ask first.
