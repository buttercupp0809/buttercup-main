# ButterCupp — Cursor Implementation Prompts

This folder contains the **sequenced, copy-paste prompts** that build ButterCupp phase by phase in Cursor. Each file corresponds to one phase in the Master PRD roadmap (`../prds/master-prd.md` §17). Run them **in order** — each assumes the previous phases are green.

## How to use
1. Open the project in Cursor.
2. Start with `00-foundation.md`. Copy the prompt block into Cursor's agent, let it implement.
3. Run the **Test instructions** and walk the **Sanity checklist** before moving to the next file.
4. Do not skip phases; later phases depend on earlier scaffolding, schema, and utilities.

## Ground rules for every phase (apply to all prompts)
- **Mirror Pellow** (`../Pellow`) for conventions: npm-workspaces monorepo, `packages/database` Prisma singleton (`import { prisma } from "@buttercupp/database"`, never `new PrismaClient()`), multi-provider fallback chains, `retry.ts`/`safe-types.ts`/`audit.ts`/`config/flags.ts` utilities, cookie JWT via `jose`, design tokens as CSS vars + reusable components, Vitest + Playwright.
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

> Phases 14 to 23 are prior extension phases (marketing site, legal pages, Google/password auth, app shell, persona gallery, chat gestures, plans/limits, paywall triggers, prompt structure, memory/RAG hardening). See the individual files for their scope.

## Experience and monetization batch (24 to 30)

These seven phases were added together to make the product magical, mobile, monetized, and memory-rich. Each is a self-contained prompt that follows the standard template and bakes in a sanity checklist plus manual E2E steps plus automated tests (Vitest + Playwright). They map 1:1 to seven product asks and are grounded in the current codebase (several of these features are partially built already, so the prompts audit and finish rather than build from zero).

| # | File | Delivers | State it targets |
|---|---|---|---|
| 24 | `24-magical-onboarding.md` | 3 to 4 step post-signup wizard: name + gender, taste/preferences, first-companion match. Adds `UserProfile` + `completedOnboardingAt`, seeds prefs. | Net-new (signup currently goes straight to `/dashboard`). |
| 25 | `25-mobile-responsive-pass.md` | Audit + harden mobile across marketing site, app shell/sidenav, chat 3-pane, and scroll/feed. Drawers/bottom-sheets, safe-area, 44px targets, tablet `md` gap. | Already mobile-first; this is a hardening pass. |
| 26 | `26-image-swap-free-asset.md` | Make the free (non-paywalled) asset the public display image everywhere (avatar, chat-top, card, gallery, landing) via an explicit `isDisplay` flag + backfill. | DB + UI swap; seed currently ships one image per character. |
| 27 | `27-payments-checkout.md` | Checkout/upgrade UI + token store, entitlement wiring, webhook activation verify. Recommends CCBill primary, SegPay fallback, Verotel third, crypto for one-time packs. | Finish (adult-friendly adapters + ledger already exist). |
| 28 | `28-creation-pipeline-fix.md` | Unify the create-time media path: kill the detached `persona_pipeline.py` subprocess, route generation through the BullMQ queue, converge `CharacterMedia`/`MediaAsset`, expose the existing edit `PATCH`. | Repair (wizard + worker work; the two media paths diverge). |
| 29 | `29-first-login-consent-modal.md` | Blocking first-login modal: TOS + privacy + 18+ acceptance, accept enters, decline auto-logs-out. Policy-version aware, server-enforced. | Harden (partial `ConsentGate.tsx` scaffold exists). |
| 30 | `30-memory-graph-port.md` | Port Pellow's graph memory: `MemoryEntity` + `MemoryEdge` models, `dreaming`/`pattern-detector`/`persona-builder`/`rulebook`/`coverage` modules, route existing extraction through the graph. | Port from `../Pellow` (extraction already fires at `engine.ts:269`). |

### Recommended build order

`26 -> 29 -> 24 -> 25 -> 28 -> 27 -> 30` (quick wins and safety first, heaviest ports last). Each is independent enough to run alone, but this order minimizes rework: the free-display asset (26) and consent gate (29) are small and unblock clean testing of onboarding (24) and the mobile pass (25); the pipeline fix (28) precedes payments (27) so generated media is stable before you gate it; the memory graph port (30) is the largest and lands last.

## Ownership and operations batch (31)

| # | File | Delivers | State it targets |
|---|---|---|---|
| 31 | `31-your-companions-and-worker-ops.md` | Net-new "Your Companions" sidenav section (per-user list of characters they own, with live image status + Chat/Regenerate), plus the BullMQ media-worker operational fix: local run runbook, `/health` queue depth + worker heartbeat observability, graceful UI when the queue is down, and a read-only prod diagnosis runbook for the `buttercupp-worker` ECS service. | Additive + repair. Ownership already exists (`Character.ownerUserId`, no migration); the Phase-28 pipeline is correct, the worker process was simply not running. |
