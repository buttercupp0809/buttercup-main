# Phase 04: Core chat with real-time streaming

## Goal
Ship the core chat workspace: real-time, token-by-token streaming replies from AI characters. Stand up a WebSocket gateway on the backend (ECS-ready) implementing the PRD §9.2 event contract (`chat.send`, `chat.token`, `chat.done`, `typing.*`, `media.request/ready`, `safety.intervention`), with an SSE fallback route in Next.js for token streaming when WS is blocked. Auth the WS handshake with the cookie JWT, and validate subscription / age-gate / rate-limit per connection. Build the LLM provider chain (OpenRouter uncensored primary, Claude/GPT premium fallback, hardcoded final fallback) mirroring Pellow's `provider.ts`, add the layered system-prompt architecture mirroring Pellow's `prompts.ts`, strip reasoning leaks, and render the streaming chat UI (token render, markdown, typing indicators, autoscroll). Persist `Conversation` + `Message` and load history on open.

Memory injection is a **placeholder** in this phase (a stub layer with a TODO); real RAG lands in Phase 05.

Covers PRD §5.3 (chat), §7.2(1) (WebSocket divergence), §9.2 (event contract), §10 (LLM design).

## Prerequisites
- Phases 00–03 green: monorepo, Prisma singleton + schema (incl. `Conversation`, `Message`, `RelationshipState`, `CharacterVersion`), cookie JWT auth (`jose`) + middleware, gallery + character detail with a chat CTA linking to `/chat/[characterId]`.
- Backend service (ECS-target Node) from Phase 00 can host a long-lived WS server; `backend/src/utils/retry.ts`, `safe-types.ts`, `audit.ts`, `config/flags.ts`, `metrics.ts` present.
- Env has at least `OPENROUTER_API_KEY` locally (plus optional `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) so the provider chain has a live primary.

## Context to paste into Cursor
> Building Poppy Phase 04 (core chat + streaming). Read `prds/master-prd.md` §5.3, §7.2(1), §9.2, §10 first. Prisma singleton `import { prisma } from "@poppy/database"`. Zod DTOs for every WS event live in `packages/shared`. TypeScript strict, no em dashes.
>
> Reference Pellow, but note the deliberate divergences:
> - Provider chain: mirror `../Pellow/backend/src/llm/provider.ts` exactly for structure (lazy per-provider clients gated on env keys, circuit-breaker `providerHealth` map with exponential cooldown, 429 retry-with-jitter, purpose-based model routing, ordered fallback, hardcoded final error). CHANGE the order for Poppy: OpenRouter **uncensored** is primary for mature chat, Claude/GPT premium is the quality/SFW fallback, then a hardcoded canned reply on total failure. Route by `character.contentRating` + user tier + jurisdiction (PRD §10).
> - System-prompt layers: mirror `../Pellow/backend/src/llm/prompts.ts` `buildPromptLayers(ctx)` (deterministic assembly, no string literals in the assembler; literals live in a `persona-prompts.ts`). Poppy layer order: base persona/behavioral instructions (from the character) → character state → RelationshipState (affection/mood) → MEMORY PLACEHOLDER (stub, TODO Phase 05) → safety guardrails → AI-disclosure constraint.
> - Reasoning-leak strip: mirror `../Pellow/backend/src/llm/client.ts` `stripThinkingBlocks(text)` (strips `<think>`/`<reasoning>`/`[thinking]` blocks incl. unclosed, reasoning preambles, third-person meta-commentary via `isMetaCommentary`, inline reasoning). Apply it to every model chunk/final text before it reaches the client.
> - IMPORTANT divergence: Pellow's `generateResponse()` is NON-streaming (one `.create()` call, full text). Poppy MUST stream token-by-token. Use the provider SDK streaming APIs (OpenAI-compatible `stream: true`, Anthropic `messages.stream`) and emit `chat.token` per delta. Keep the same provider fallback semantics, just in streaming form.

## Build steps
Do these in order. Name files exactly as below.

1. **WS event contract DTOs**: `packages/shared/src/ws.ts`
   - Zod schemas + inferred types for every event in PRD §9.2. Client→server: `chatSend` `{ conversationId, text }`, `chatCancel` `{ conversationId }`, `typingStart` / `typingStop`, `mediaRequest` `{ kind, conversationId }`. Server→client: `chatToken` `{ conversationId, delta }`, `chatDone` `{ conversationId, messageId }`, `typingIndicator`, `mediaReady` `{ mediaAssetId, url }`, `relationshipUpdate`, `safetyIntervention` `{ message, resources }`, `error` `{ code, message }`. Export a discriminated-union `WSClientEvent` / `WSServerEvent`. Re-export from `packages/shared/src/index.ts`.

2. **Provider chain (streaming)**: `backend/src/llm/provider.ts` + `backend/src/llm/constants.ts`
   - Port Pellow's structure: lazy `getOpenRouterClient()` / `getAnthropicClient()` / `getOpenAIClient()` gated on env keys; `providerHealth` circuit breaker with exponential cooldown; `isRateLimitError` + `callWithRateLimitRetry` (jitter); per-provider metrics via `incrementCounter`.
   - Add `streamLLM(params, onToken): Promise<LLMCallResult>` alongside the non-streaming `callLLM` (keep `callLLM` for extract/summary purposes used later). `streamLLM` iterates provider deltas and invokes `onToken(delta)`; on a mid-stream provider failure before any token was emitted, fall through to the next provider (do not double-emit once tokens have started; mark the provider failed and finish with what streamed or a fallback).
   - Order for `purpose: "chat"`: 1) OpenRouter uncensored model, 2) Anthropic/OpenAI premium, 3) hardcoded fallback string. `constants.ts` holds `MODELS` (uncensored OpenRouter model id, premium model ids).
   - `resolveModelRouting({ contentRating, tier, jurisdiction })`: mature → uncensored primary; SFW or premium tier → premium primary. Comment the jurisdiction hook.

3. **System-prompt layers**: `backend/src/llm/prompts.ts` + `backend/src/llm/persona-prompts.ts`
   - `persona-prompts.ts` holds all literal blocks (base behavioral rules, AI-disclosure constraint text, safety guardrail text, layer label helpers). `prompts.ts` exports `buildPromptLayers(ctx: PromptContext): string` with deterministic assembly and NO string literals, mirroring Pellow. `PromptContext` includes `characterVersion` (persona/backstory/behavioralInstructions/greeting), `relationshipState`, `injectedMemory?: string` (the Phase 05 slot; for now pass a stubbed `null` and push a `TODO(phase-05)` comment where the memory layer would insert), `userAge`, `contentRating`.
   - Layer order (PRD §10): persona/behavioral → character state → relationship (affection/mood) → memory placeholder → safety guardrails → AI-disclosure. Keep it snapshot-testable.

4. **Reasoning-leak strip**: `backend/src/llm/sanitize.ts`
   - Port `stripThinkingBlocks(text)` and helpers (`isMetaCommentary`, inline-reasoning strip) from Pellow's `client.ts`. Expose `stripThinkingBlocks` for the final text and a lightweight incremental guard for streaming (buffer until a tag boundary is resolvable so a partial `<think>` is never forwarded as tokens).

5. **Turn orchestrator**: `backend/src/chat/engine.ts`
   - `runChatTurn({ conversationId, userId, userText, onToken, onDone, onSafety })`:
     - Load conversation + pinned `CharacterVersion` + recent `Message` history + `RelationshipState`.
     - Persist the user `Message`.
     - `[safety placeholder]` fast pre-generation crisis check hook (real detector in Phase 11); if it fires, emit `safety.intervention` and skip generation.
     - Build prompt via `buildPromptLayers`, resolve routing, call `streamLLM(..., onToken=strip+forward)`.
     - On finish: strip final text, persist assistant `Message`, update `Conversation.lastMessageAt`/`messageCount`, emit `chat.done` with the messageId. Leave a `TODO(phase-05)` to fire the async memory extractor here.

6. **WebSocket gateway**: `backend/src/ws/gateway.ts` (+ server wiring in `backend/src/index.ts`)
   - `ws`-based server attached to the HTTP server (ALB/WS-ready). On handshake: parse the cookie JWT (`jose`, audience-scoped, same secret as Phase 01), reject unauthenticated. Per connection, build a session context (userId, tier). On `chat.send`: validate DTO (Zod), assert the conversation belongs to the user, run age-gate + subscription check (mature conversation requires age-verified), rate-limit (per-user token bucket in Redis or in-memory for local), then call `runChatTurn` wiring `onToken → send chat.token`. Handle `chat.cancel` (abort the in-flight stream), `typing.*` (echo indicator). Emit `error` frames on validation/limit failures. Fire-and-forget `audit.ts` on safety and rate-limit events.

7. **SSE fallback route**: `frontend/app/api/chat/stream/route.ts`
   - `POST` streaming route (Next.js `ReadableStream` / `text/event-stream`) that authenticates via cookie, runs the same `runChatTurn` path, and emits `chat.token` / `chat.done` as SSE events. This is the fallback when WS is blocked. Same auth/age/rate checks as the gateway.

8. **Client transport**: `frontend/lib/chat-transport.ts`
   - A transport hook that prefers WS (`frontend/lib/ws-client.ts`, auto-reconnect with backoff, resubscribe on reconnect) and falls back to the SSE route when the WS connection cannot be established. Exposes `sendMessage`, `onToken`, `onDone`, `onTyping`, `onSafety`.

9. **Chat UI**: `frontend/app/(app)/chat/[characterId]/page.tsx` + components
   - Server component loads the conversation (create if none) + history. `frontend/components/chat/ChatWindow.tsx` (client): message list with autoscroll, `frontend/components/chat/MessageBubble.tsx` (markdown render), `frontend/components/chat/StreamingBubble.tsx` (appends `chat.token` deltas live), `frontend/components/chat/TypingIndicator.tsx`, `frontend/components/chat/Composer.tsx` (input bar; voice/image request buttons stubbed for Phases 08/09). Header shows character avatar/name + affection status from `RelationshipState` + a persistent **AI-disclosure** badge (SB 243). On `safety.intervention`, render the intervention message inline instead of a normal bubble.

10. **History + conversation endpoints**: `frontend/app/api/conversations/route.ts` (`GET` list, `POST` start-with-character) and `frontend/app/api/conversations/[id]/messages/route.ts` (`GET` paginated history). Zod-validated; ownership-checked.

## Test instructions
- **Vitest (provider fallback):** `backend/src/llm/__tests__/provider.test.ts`: mock clients so the primary throws before emitting a token; assert the next provider serves and metrics/`chat_fallback` counter bumps; assert a hardcoded fallback when all fail.
- **Vitest (prompt composition):** `backend/src/llm/__tests__/prompts.test.ts`: snapshot `buildPromptLayers` output; assert layer order (persona → state → relationship → memory placeholder → safety → AI-disclosure) and determinism for identical context.
- **Vitest (reasoning strip):** `backend/src/llm/__tests__/sanitize.test.ts`: `<think>...</think>`, unclosed `<think>`, and a meta-commentary preamble are removed; normal text is untouched; the streaming incremental guard never forwards a partial tag.
- **Playwright (E2E):** `frontend/e2e/chat.spec.ts`: an authed, eligible user opens a character chat, sends a message, and sees tokens stream in progressively; on reload, the exchange persists in history.
- Run: `npm run test -w backend -- llm` and `npm run test:e2e -w frontend -- chat`.

## Sanity checklist
- [ ] First token arrives < 1s locally (p50 target, PRD §6).
- [ ] WS reconnects after a dropped connection and resubscribes without losing the conversation.
- [ ] SSE fallback streams correctly when WS is blocked (simulate by disabling the WS client).
- [ ] Model routing respects `contentRating`: a mature character routes to the OpenRouter uncensored primary; an SFW/premium path routes to the premium provider.
- [ ] Reasoning/thinking blocks never appear in the rendered reply (no `<think>`, no "the user wants..." preambles).
- [ ] WS handshake rejects an unauthenticated connection; a mature conversation is refused for a non-age-verified user; rate limiting triggers an `error` frame, not a crash.
- [ ] History persists across reload; `Conversation.lastMessageAt` / `messageCount` update per turn.
- [ ] The AI-disclosure badge is always visible in the chat header.

## Done criteria
"Green" = provider-fallback, prompt-composition, and reasoning-strip Vitest suites pass; the Playwright chat spec shows live token streaming and persisted history; WS auth + age-gate + rate-limit hold; SSE fallback works; and routing respects contentRating. The memory layer is an explicit placeholder with a `TODO(phase-05)` (real RAG is Phase 05).

## Guardrail note
Do not commit, push, deploy, or run a non-local migration in this phase. Provider API keys are local-env only; do not write them to any hosted secret store. Every commit, push, deploy, or non-local DB migration requires a fresh, explicit, per-action human approval. Stop and ask before any such action.
