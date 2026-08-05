# Phase 22: Fill-in prompt template structure

## Goal
Refactor prompt building into a fill-in TEMPLATE system under `backend/src/llm/prompt-templates/`, composed by `prompts.ts`, WITHOUT changing the deterministic layer order or regressing current chat behavior. Each layer becomes a named template file with CLEARLY-MARKED `{{PLACEHOLDERS}}` that the user (you) fills with guideline prompts. A loader reads templates at build time (hot-reload in dev), resolves placeholders, keeps the safety layer LOCKED (not user-editable, not overridable), and preserves the existing memory placeholder wiring so retrieved memories still inject. A `PROMPTS.md` index tells the user EXACTLY where to paste each guideline and the composition order. The output of `buildPromptLayers(...)` for a fixed character must be equivalent to today's (a golden test locks this) so existing chat quality is preserved.

Covers PRD §2.7 (prompt placeholder structure). Requirement 16. Couples with Phase 19: the gesture-format instruction moves into `10-gesture-format.md` here.

## Prerequisites
- Phase 19 landed (gesture instruction exists as an interim literal in `persona-prompts.ts` / `OUTPUT_RULES`).
- Current prompt building (do NOT regress):
  - `backend/src/llm/prompts.ts` — `buildPromptLayers(ctx: PromptContext): string`. Deterministic, NO string literals of its own; imports every block from `persona-prompts.ts`. Current layer order: `identity -> persona -> state -> relationship -> memory -> user -> output -> safety -> disclosure`.
  - `backend/src/llm/persona-prompts.ts` — all literals: `IDENTITY`, `OUTPUT_RULES`, `SAFETY_GUARDRAILS`, `AI_DISCLOSURE_CONSTRAINT`, `MEMORY_PLACEHOLDER`, `LABELS`, plus block helpers `personaBlock`, `characterStateBlock`, `relationshipBlock`, `memoryBlock`, `userContextBlock`.
  - `backend/src/chat/engine.ts` — calls `buildPromptLayers(...)` then `streamLLM(...)`. It already retrieves memories via `renderMemoryBlock(...)` and passes them as `injectedMemory`; that wiring must keep working unchanged.
- Existing snapshot test at `backend/src/llm/prompts.test.ts` (do not delete; extend).

## Context to paste into Cursor
> Building Poppy Phase 22 (fill-in prompt template structure). Read `prds/experience-monetization-prd.md` §2.7 first. This is an ADDITIVE refactor: the composed system prompt for a fixed character must be equivalent to today's output. TypeScript strict, no em dashes.
>
> Ground truth to respect:
> - `buildPromptLayers` is the single composition entry point and stays the public API (engine.ts calls it). Layer ORDER is load-bearing and must not change: identity -> persona -> state -> relationship -> memory -> user -> output -> safety -> disclosure.
> - Today all literals live in `persona-prompts.ts`. You are moving the EDITABLE literals into `.md` template files with `{{PLACEHOLDER}}` slots, and having a loader compose them. Per-character injection (persona/backstory/behavioral), relationship values, memory, and user context are RUNTIME values, not user-pasted guidelines; those stay computed by the block helpers and fed into the template.
> - The SAFETY layer (`60-safety.md`) is LOCKED: it has no user-editable placeholder, the loader never lets a placeholder override it, and it is always present in the composed prompt (SB 243 / crisis / hard rules).
> - The MEMORY layer (`40-memory.md`) keeps the existing wiring: the RAG slot fills from `injectedMemory` (the `renderMemoryBlock(...)` output engine.ts already produces), falling back to `MEMORY_PLACEHOLDER` when empty. Do not break Phase 05 memory injection.
> - No secrets, no API keys, no PII in any template file.

## Build steps
Do these in order. Name files exactly as below.

1. **Template directory + layer files**: `backend/src/llm/prompt-templates/`
   Create one `.md` file per layer. USER-fillable placeholders are in `{{DOUBLE_BRACES}}`; runtime-injected values use a distinct marker (for example `{{@RUNTIME}}`) so the loader can tell them apart. Files:
   - `00-base-persona.md` — base companion behavior. Contains today's `IDENTITY` text plus a `{{BASE_PERSONA_GUIDELINES}}` slot for the user's global companion guidelines.
   - `10-gesture-format.md` — the italics rule (physical/emotional gestures in `*...*`, dialogue plain), with a `{{GESTURE_STYLE_GUIDELINES}}` slot. Move the Phase 19 gesture instruction here.
   - `20-character.md` — per-character injection. Runtime slots for name / personality / backstory / behavioral instructions (fed by the current `personaBlock` + `characterStateBlock` values). No user placeholder.
   - `30-relationship.md` — affection / mood / milestones. Runtime slots fed by `relationshipBlock`. No user placeholder.
   - `40-memory.md` — retrieved-memory RAG slot. A single runtime slot that fills from `injectedMemory`, falling back to `MEMORY_PLACEHOLDER`. No user placeholder.
   - `50-content-mode.md` — SFW vs mature guidelines, with `{{MATURE_GUIDELINES}}` and `{{SFW_GUIDELINES}}` slots. The loader selects the branch by `contentRating`. (Today content mode is folded into `characterStateBlock`; this splits it out cleanly without changing the rendered result for a fixed rating.)
   - `60-safety.md` — LOCKED. Contains today's `SAFETY_GUARDRAILS` (SB 243 / crisis / hard rules). No placeholder; not user-editable.
   - `70-output-rules.md` — length, no-thinking-leak, gesture reminder. Contains today's `OUTPUT_RULES` and the `AI_DISCLOSURE_CONSTRAINT` reminder. Optional `{{OUTPUT_GUIDELINES}}` slot if useful; the disclosure text stays fixed.

2. **Template loader**: `backend/src/llm/prompt-templates/loader.ts`
   - Read the `.md` files once at module load (cache the raw strings). In dev (`NODE_ENV !== "production"`), stat/watch or re-read on each `buildPromptLayers` call so edits hot-reload without a restart; in prod, read once and cache.
   - Export `loadTemplate(name)` and `resolve(template, values)` where `resolve` substitutes `{{PLACEHOLDER}}` and `{{@RUNTIME}}` markers from a values map. Unknown or empty user placeholders resolve to empty string (a blank guideline is valid), not to the literal `{{...}}`.
   - The loader NEVER exposes a substitution path into `60-safety.md`. `resolve` on the safety template is a no-op / identity; assert this in code with a guard so a future caller cannot inject into it.

3. **Recompose `prompts.ts`**: `backend/src/llm/prompts.ts`
   - Keep the exported `buildPromptLayers(ctx: PromptContext): string` signature and `PromptContext` shape UNCHANGED (engine.ts depends on both).
   - Internally: load each numbered template, resolve runtime values from `ctx` (character fields via the existing block helpers, relationship values, `injectedMemory`, `userAge`, content-mode branch by `ctx.contentRating`), and join in the SAME order the current 9-part array produces. The identity/persona/state/relationship/memory/user/output/safety/disclosure sequence must be byte-equivalent to today for a fixed context (see golden test).
   - Keep `persona-prompts.ts` for the runtime block HELPERS (`personaBlock`, `relationshipBlock`, `memoryBlock`, etc.) since those format runtime values; the editable LITERALS now live in the templates. If a literal is fully replaced by a template, leave a short comment pointing to the template file rather than deleting silently.

4. **User index**: `backend/src/llm/prompt-templates/PROMPTS.md`
   - A human guide, no code. Lists every layer file in composition ORDER, states exactly which `{{PLACEHOLDER}}` each file exposes and what to paste there, marks `60-safety.md` as LOCKED (do not edit), and notes that `20/30/40` are runtime-injected (do not hand-edit values). Include a one-line "composition order" summary and a warning: no secrets / no PII in templates.

5. **Wire-through check**: `backend/src/chat/engine.ts`
   - No signature change needed. Confirm it still calls `buildPromptLayers(...)` with the same `ctx` (including `injectedMemory` from `renderMemoryBlock`). Add no new logic; just verify the memory slot still receives retrieved memories.

## Test instructions
- **Vitest (composition + order):** `backend/src/llm/prompts.test.ts` (extend)
  - Compose for a fixed `PromptContext` and assert all layers are present in the exact order (identity/base -> gesture -> character -> relationship -> memory -> content-mode -> output -> safety -> disclosure, matching the current effective sequence).
  - Assert every `{{PLACEHOLDER}}` resolves (no residual `{{...}}` in the output).
  - Assert the safety layer text is always present and that a crafted values map attempting to override the safety slot has NO effect (locked-layer test).
  - Assert the memory slot injects a non-empty `injectedMemory` when provided, and falls back to `MEMORY_PLACEHOLDER` when null (Phase 05 wiring preserved).
- **Vitest (golden equivalence):** `backend/src/llm/__tests__/prompts.golden.test.ts`
  - Snapshot the composed prompt for a fixed character/context and compare against the pre-refactor output (capture the current `buildPromptLayers` output as the golden baseline BEFORE refactoring, commit it as a fixture in the test, then assert equivalence). This proves existing chat quality is preserved.
- **Vitest (no secrets/PII):** scan the `prompt-templates/*.md` files and assert none contain obvious secret patterns (API-key-like strings, emails) as a lightweight guard.
- Run: `npm run test -w backend -- prompts`.

## Sanity checklist
- [ ] `buildPromptLayers` signature and `PromptContext` shape are unchanged; engine.ts compiles without edits to its call.
- [ ] Composed prompt for a fixed character is byte-equivalent to the pre-refactor output (golden test passes).
- [ ] All layers appear in the correct, deterministic order; no residual `{{placeholder}}` leaks into the prompt.
- [ ] Safety layer (`60-safety.md`) is always present and cannot be overridden by any placeholder value.
- [ ] Memory slot still injects retrieved memories (Phase 05) and falls back to the placeholder when empty.
- [ ] Content-mode branch selects mature vs SFW guidelines by `contentRating` with the same effective result as today.
- [ ] Dev edits to a template hot-reload; prod reads once and caches.
- [ ] `PROMPTS.md` tells the user exactly where each guideline goes; no secrets or PII in any template file.

## Done criteria
"Green" = the composition/order, placeholder-resolution, locked-safety, and memory-slot Vitest assertions pass; the golden-equivalence test confirms the composed prompt matches the pre-refactor baseline for a fixed character; `PROMPTS.md` documents every placeholder and the composition order; the safety layer is provably non-overridable; and no template contains secrets or PII. Chat quality is preserved because the effective prompt is unchanged.

## Guardrail note
Do not commit, push, deploy, or run a non-local migration in this phase. This is a backend refactor of prompt composition with no schema change. Every commit, push, deploy, or non-local DB migration requires a fresh, explicit, per-action human approval. Stop and ask before any such action.
