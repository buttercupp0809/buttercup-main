# Poppy conventions

This file is the source of truth for repo-wide rules. Later phases extend but
never contradict it. If a rule below conflicts with something you find in a
subdir, this file wins.

## Monorepo layout

```
poppy/
  frontend/            Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui
  backend/             Node + TypeScript server (REST helpers, WS gateway,
                       BullMQ worker in later phases)
  packages/database/   @poppy/database. Prisma 6 + Postgres + pgvector.
                       Exports the singleton `prisma` client.
  packages/shared/     @poppy/shared. Zod schemas and shared TypeScript
                       types used on both sides of the wire.
  e2e/                 Playwright specs (baseURL http://localhost:3000).
  Plans/               Product and phase plans (source of truth for scope).
  prds/                Master PRD and supporting specs.
```

Owner rules:

- `frontend/` owns everything user-facing plus route-handler REST endpoints.
- `backend/` owns long-running processes: the WebSocket gateway (Phase 04) and
  the BullMQ media worker (Phase 07). It is NOT the primary REST layer.
- `packages/database/` owns the Prisma schema, migrations, and the singleton.
  No app code lives here.
- `packages/shared/` owns cross-cutting types and Zod schemas. No runtime side
  effects, no I/O, no Node-only imports.

## The Prisma singleton (hard rule)

There is exactly one `PrismaClient` instance per process. It is constructed
inside `packages/database/src/client.ts` and nowhere else.

Canonical import, from any workspace:

```ts
import { prisma } from "@poppy/database";
```

Never write `new PrismaClient()` outside `packages/database/src/client.ts`.
Doing so leaks database connections during `next dev` HMR, breaks pool sizing
in serverless, and defeats the pool-param injection that `getDbUrl()` performs.
Reviewers reject PRs that violate this rule.

## No em dashes

Do not use the em dash character (U+2014, `\u2014`) anywhere: code, comments,
docs, commit messages, PR descriptions. Use commas, periods, or parentheses.
Enforced by `eslint.config.mjs` (the `poppy/no-em-dash` custom rule) and by
`npm run check:no-em-dash` (a repo-wide scan that covers Markdown, Prisma,
Docker, YAML).

## TypeScript

- Strict mode is on everywhere. No `any` unless annotated with a comment
  explaining why the type cannot be modeled.
- `zod` validates every mutation at the trust boundary (route handlers, WS
  messages, worker payloads, webhook bodies). Never trust `req.body` shape
  from types alone.
- Next.js 16 App Router with server-centric rendering. Keep client state
  minimal; prefer Server Components and Server Actions.
- Backend TS compiles to CommonJS in `dist/`; frontend TS is handled by Next.

## Guardrails (ask before you touch)

Never do the following without an explicit, fresh, per-action human approval:

- `git commit`, `git push`, or any tag/branch write to a remote.
- Deploy to Amplify, ECS, or any hosted environment.
- Push a Docker image to a remote registry.
- Run a migration (`prisma migrate deploy`, `db push`) against any database
  other than a LOCAL one you booted yourself.
- Rotate, mint, or reveal any secret.

When unsure whether an action is prod-touching, assume it is and ask first.

Fine without asking: local `npm install`, `npm run typecheck`, `npm run build`,
`npm test`, `docker build` with no push, `psql` against a local database.

## Where phase specs live

- Master PRD: `prds/master-prd.md` (referenced by every phase plan).
- Per-phase Cursor prompts: `Plans/cursor-prompt/NN-*.md`.

Read the relevant phase plan before you start; do not invent scope.
