# Poppy — Cursor Implementation Prompts

This folder contains the **sequenced, copy-paste prompts** that build Poppy phase by phase in Cursor. Each file corresponds to one phase in the Master PRD roadmap (`../prds/master-prd.md` §17). Run them **in order** — each assumes the previous phases are green.

## How to use
1. Open the project in Cursor.
2. Start with `00-foundation.md`. Copy the prompt block into Cursor's agent, let it implement.
3. Run the **Test instructions** and walk the **Sanity checklist** before moving to the next file.
4. Do not skip phases; later phases depend on earlier scaffolding, schema, and utilities.

## Ground rules for every phase (apply to all prompts)
- **Mirror Pellow** (`../Pellow`) for conventions: npm-workspaces monorepo, `packages/database` Prisma singleton (`import { prisma } from "@poppy/database"`, never `new PrismaClient()`), multi-provider fallback chains, `retry.ts`/`safe-types.ts`/`audit.ts`/`config/flags.ts` utilities, cookie JWT via `jose`, design tokens as CSS vars + reusable components, Vitest + Playwright.
- **Locked decisions** (PRD §0): mature-gated from day 1 (age verification, adult-friendly payment processor, OpenRouter uncensored model, SB 243 protocol), AWS infra (Amplify + ECS Fargate + RDS + pgvector + Redis + S3), all four hard capabilities in MVP, web-first responsive PWA.
- **TypeScript strict**; Zod validation on every mutation; server-centric Next.js 16 App Router.
- **No em dashes** in code, comments, or docs (use commas/periods/parentheses).
- **GUARDRAIL**: never commit, push, migrate a non-local DB, or deploy without an explicit, fresh, per-action human approval. Every prompt below ends with this reminder. Cursor agents must stop and ask before any such action.

## Standard template (every phase file follows this)
```
# Phase NN: <Title>
## Goal
## Prerequisites
## Context to paste into Cursor   (PRD sections + Pellow reference paths)
## Build steps                    (ordered, concrete, file-by-file)
## Test instructions              (exact Vitest / Playwright / manual commands)
## Sanity checklist               (observable pass/fail checks)
## Done criteria                  (what "green" means before next phase)
## Guardrail note                 (commit/deploy require explicit approval)
```

## Phase index
| # | File | Delivers |
|---|---|---|
| 00 | `00-foundation.md` | Monorepo scaffold, `packages/database` (Prisma + pgvector singleton), `packages/shared`, tooling, Dockerfile, `.env.example`, `CLAUDE.md`, `.cursor` design skill |
| 01 | `01-auth-age-gate.md` | Cookie JWT auth, signup/login/OAuth, age verification + mature gate, middleware guards, AI-disclosure scaffold |
| 02 | `02-data-model.md` | Full Prisma schema, migrations, system-character seed |
| 03 | `03-character-gallery.md` | Public gallery, cards, filter/sort/search, detail, restricted CTA |
| 04 | `04-chat-streaming.md` | WebSocket gateway + SSE fallback, LLM provider chain, system-prompt layers, streaming UI, typing, history |
| 05 | `05-memory-rag.md` | pgvector store, extractor/retriever, summarization/tiering, prompt injection |
| 06 | `06-creation-wizard.md` | 5-step wizard, appearance sheet, voice profile, publish, indexing |
| 07 | `07-media-queue.md` | BullMQ + Redis worker, S3, WS media-ready push, token debit |
| 08 | `08-voice-tts.md` | ElevenLabs streaming per character, voice-decision, audio player |
| 09 | `09-image-gen.md` | Fal/Replicate, character consistency (ref sheet + LoRA/IP-Adapter), render |
| 10 | `10-billing-tokens.md` | Tiers + token ledger, adult-friendly processor, webhooks, paywall |
| 11 | `11-safety-compliance.md` | Crisis detector + SB 243 protocol, break reminders, jurisdiction gating, audit |
| 12 | `12-settings-observability.md` | Settings/account, export/delete, Sentry, analytics, metrics |
| 13 | `13-deploy-aws.md` | Amplify + ECS + RDS + ElastiCache + S3 + CloudFront, CI (build only) |
