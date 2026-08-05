# Phase 19: Engaging chat + gesture/dialogue formatting

## Goal
Turn the plain chat surface into the product's differentiator. Give `ChatWindow` a rich renderer that parses assistant text and shows PHYSICAL and EMOTIONAL GESTURES in styled ITALICS (any run wrapped in single `*asterisks*`) while spoken dialogue and narration render as NORMAL text. The renderer must be streaming-safe (parse incrementally with no flicker as tokens arrive), robust to unmatched, nested, and escaped asterisks, and applied to assistant messages ONLY (user messages stay plain). Add a typing indicator (animated dots) shown while awaiting the first token, keeping the existing streaming cursor once tokens start. Add the immersive polish from PRD §1: character avatar plus a subtle blurred character backdrop, and an affection meter in the header driven by `RelationshipState`. On the model side, tell the model to emit gestures in `*asterisks*` and dialogue plain by adding a gesture-format instruction to the output/gesture rules. This couples with Phase 22's prompt templates: the wording is the `{{GESTURE_STYLE_GUIDELINES}}` placeholder in `10-gesture-format.md`, so keep this instruction small and reference that template slot.

Covers PRD §2.5 (chat experience + gesture formatting) and §1 (immersive product UI). Requirement 13.

## Prerequisites
- Phases 00–13 green, and Phase 17 (app shell) / Phase 18 (gallery) landed. The chat route works today.
- Current chat surface (do NOT regress):
  - `frontend/app/(protected)/chat/[characterId]/page.tsx` — server component, loads the conversation and last 50 messages, renders `ChatWindow`.
  - `frontend/components/chat/ChatWindow.tsx` — client component. `MessageBubble` is a LOCAL function inside this file; it renders `whitespace-pre-wrap` RAW text (no markdown, no italic parsing) and shows a pulsing `|` streaming cursor. There is NO typing indicator today.
  - `frontend/lib/chat-transport.ts` — WS-first, SSE fallback. Emits `TransportEvent` of type `token` / `done` / `safety` / `error`. Wire order and event names must not change.
  - `frontend/components/chat/ImageMessage.tsx`, `frontend/components/chat/VoiceMessage.tsx`, `frontend/components/ai-disclosure.tsx` all exist and must be preserved.
- Backend prompt building: `backend/src/llm/prompts.ts` (`buildPromptLayers`) + `backend/src/llm/persona-prompts.ts` (`OUTPUT_RULES` literal). `backend/src/chat/engine.ts` calls `buildPromptLayers(...)` then `streamLLM(...)`.

## Context to paste into Cursor
> Building Poppy Phase 19 (engaging chat + gesture/dialogue formatting). Read `prds/experience-monetization-prd.md` §2.5 and §1 first. This is an ADDITIVE, non-regressive visual + parsing layer over an existing, working chat. Routing, API, transport, and data contracts are UNCHANGED. TypeScript strict, no em dashes.
>
> Ground truth to respect:
> - `frontend/components/chat/ChatWindow.tsx` holds `MessageBubble` as a local function that renders `whitespace-pre-wrap` raw text with a pulsing `|` cursor while streaming. You are replacing the RENDER of assistant text only. User bubbles stay plain.
> - `frontend/lib/chat-transport.ts` emits `TransportEvent` (`token` | `done` | `safety` | `error`). Do not rename events, do not change WS-first / SSE-fallback order, do not change the frame shapes.
> - `frontend/components/ai-disclosure.tsx` and the SB 243 "You are chatting with an AI" pill in the chat header MUST remain visible at all times.
> - `ImageMessage.tsx`, `VoiceMessage.tsx`, and the inline safety-intervention banner in `ChatWindow` must keep rendering exactly as today.
>
> Gesture rule (product differentiator, PRD §2.5): assistant text uses single `*asterisks*` to wrap physical + emotional gestures / actions (for example `*she smiles softly*`), and leaves spoken dialogue and narration plain. The renderer converts `*...*` runs to styled italic spans (muted, italic, visually distinct from dialogue) and leaves everything else as normal text. The PARSER must be pure and O(n), and must handle: matched pairs, an UNMATCHED trailing `*` (treat the tail as literal until its closer arrives), NESTED / doubled asterisks (do not produce empty or overlapping spans), and ESCAPED `\*` (render a literal asterisk, never a delimiter). Because tokens stream in, the parser runs on the growing string every render and must be deterministic so a half-open gesture does not flicker between italic and plain: an unclosed `*` renders its content as PLAIN pending text, and only becomes italic once the closing `*` arrives.

## Build steps
Do these in order. Name files exactly as below.

1. **Gesture parser (pure, tested first)**: `frontend/lib/gesture-format.ts`
   - Export `type Segment = { kind: "text"; value: string } | { kind: "gesture"; value: string }`.
   - Export `parseGestures(input: string): Segment[]`. Single-pass, O(n). Rules:
     - `\*` is an escaped literal asterisk: emit a `*` character into the current text run, never a delimiter.
     - A `*` opens a gesture; the next unescaped `*` closes it. The closed inner run becomes a `gesture` segment (trim nothing; preserve inner spaces).
     - Empty gestures (`**`) collapse to nothing (no empty span).
     - Doubled / nested asterisks: treat greedily left to right; never emit overlapping segments. An inner `*` inside an open gesture closes it (flat model, no nesting depth), so `*a*b*` = gesture `a`, text `b`, dangling `*` (see below).
     - A trailing UNMATCHED `*` (no closer yet) and everything after it render as a plain `text` segment (pending). This is what makes streaming flicker-free: partial `*she smil` shows plain, and only flips to italic when the closing `*` streams in.
   - Merge adjacent `text` segments so the output is minimal.
   - Keep this file framework-free (no React) so it is trivially unit-testable and reusable by the SSE and WS paths alike.

2. **Gesture renderer component**: `frontend/components/chat/GestureText.tsx`
   - `"use client"`. Props `{ content: string }`. Calls `parseGestures(content)` and maps segments: `text` -> a plain `<span>` (preserve whitespace with `whitespace-pre-wrap` on the container), `gesture` -> `<span className="italic text-rose-300/80">` (muted italic, visually distinct from dialogue; use the dark-theme accent from PRD §1, tune the exact class in the design pass).
   - Memoize on `content` so re-renders during streaming only re-parse when the string actually grew.
   - This component renders assistant text only. Never used for user messages.

3. **Typing indicator**: `frontend/components/chat/TypingDots.tsx`
   - `"use client"`. Three dots with a staggered bounce animation (Tailwind `animate-bounce` with per-dot delay, or a small keyframe). Accessible: `role="status"` + visually-hidden "typing".
   - Shown by `ChatWindow` while a turn is pending AND no token has arrived yet. Once the first `token` event lands, hide the dots and show the streaming bubble with the existing cursor.

4. **Rework `ChatWindow` render**: `frontend/components/chat/ChatWindow.tsx`
   - In the local `MessageBubble`, branch on role:
     - `role === "user"`: keep the current plain `whitespace-pre-wrap` render. NO gesture parsing, NO italics.
     - `role === "assistant"` (and system): render `<GestureText content={content} />` inside the bubble; keep the pulsing `|` cursor when `streaming` is true, appended after the parsed content.
   - Track "first token seen" for the in-flight turn: add local state `firstTokenSeen` set true on the first `token` event, reset false on `submit` and on `done`/`safety`/`error`. While `pending && !firstTokenSeen`, render `<TypingDots />` in the assistant slot instead of an empty streaming bubble. After the first token, render the streaming `MessageBubble` as today.
   - Do NOT change the transport wiring, the `streamedRef` dedupe logic, the `done` id-dedupe, the safety banner block, or the AI-disclosure pill. The only changes are: assistant text goes through `GestureText`, and the typing-dots gate.

5. **Immersive header + backdrop (PRD §1)**: `frontend/components/chat/ChatWindow.tsx` (+ pass-through props)
   - Header: character avatar (small round image) next to the name, the existing SB 243 AI pill preserved, and an affection meter.
   - Affection meter: a compact bar or heart-scale fed by `RelationshipState.affectionLevel`. Add optional props to `ChatWindow` (`avatarUrl?: string`, `affectionLevel?: number`, `mood?: string | null`) and thread them from the page (step 6). If absent, render a neutral default (no crash).
   - Backdrop: a subtle blurred character image behind the message list (low opacity, `blur`, dark scrim so text stays high-contrast, `aria-hidden`). Must not intercept clicks (`pointer-events-none`) and must not reduce message legibility.

6. **Feed avatar + relationship into the page**: `frontend/app/(protected)/chat/[characterId]/page.tsx`
   - The server component already loads `character` (+ `currentVersion`) and the conversation. Additionally load the `RelationshipState` for `(user.id, characterId)` (may be null) and the character avatar/image URL from the character record.
   - Pass `avatarUrl`, `affectionLevel` (default 0 when no relationship row), and `mood` into `ChatWindow`. Do not change the existing message-loading (last 50) or conversation reuse/create logic.

7. **Model instruction (gesture format)**: `backend/src/llm/persona-prompts.ts` + `backend/src/llm/prompts.ts`
   - Add a small literal `GESTURE_FORMAT` in `persona-prompts.ts` instructing the model: wrap physical and emotional gestures / actions in single `*asterisks*` (for example `*leans in*`, `*blushes*`) and keep spoken dialogue and narration plain; do not use markdown bold or headings in replies. Keep it short.
   - Wire it into the output layer: either append `GESTURE_FORMAT` to the existing `OUTPUT_RULES` block, or add a labeled sub-line in `buildPromptLayers` right next to the output rules. Keep the deterministic layer ORDER unchanged (identity -> persona -> state -> relationship -> memory -> user -> output -> safety -> disclosure). Add a comment noting this text is the interim home for `{{GESTURE_STYLE_GUIDELINES}}` and moves into `backend/src/llm/prompt-templates/10-gesture-format.md` in Phase 22.
   - This is additive text only. Do not touch the safety, disclosure, or memory layers.

## Test instructions
- **Vitest (gesture parser):** `frontend/lib/__tests__/gesture-format.test.ts`
  - Matched: `*she smiles* hello` -> `[gesture "she smiles", text " hello"]`.
  - Unmatched trailing: `hi *she smil` -> `[text "hi ", text "*she smil"]` (or a single merged plain `text`); the dangling `*` run renders PLAIN.
  - Streaming progression: assert `parseGestures("*she smil")` yields plain text, and `parseGestures("*she smiles*")` yields an italic gesture (proves the flicker-free contract).
  - Nested / doubled: `*a*b*` -> gesture `a`, text `b`, dangling plain; `**` -> empty (no gesture segment).
  - Escaped: `2 \* 3 = 6` -> single text run containing a literal `*`, no gesture.
  - Adjacent text merge: consecutive plain runs collapse into one.
- **Playwright (E2E):** `frontend/e2e/chat-gestures.spec.ts`
  - Authed eligible user opens a character chat, sends a message. Assert: typing dots appear before the first token, then a streamed reply; a `*gesture*` run renders as an italic span (`.italic`) while dialogue is normal; the user's own bubble is NOT italicized even if the user typed asterisks.
- Run: `npm run test -w frontend -- gesture-format` and `npm run test:e2e -w frontend -- chat-gestures`.

## Sanity checklist
- [ ] AI-disclosure pill (SB 243) is still visible in the chat header at all times.
- [ ] `ImageMessage` and `VoiceMessage` still render; the inline safety-intervention banner still renders on `safety` events.
- [ ] WS-first with SSE fallback still works and the `token` / `done` / `safety` / `error` event order is unchanged (disable the WS client to confirm SSE).
- [ ] Assistant gestures wrapped in `*...*` render italic and muted; dialogue renders normal.
- [ ] User messages are NEVER italicized, even when the user types asterisks.
- [ ] Streaming shows typing dots first, then the cursor; no flicker as a half-open `*gesture` closes into italic.
- [ ] Unmatched, nested, and escaped asterisks never crash and never produce empty or overlapping spans.
- [ ] Affection meter reflects `RelationshipState.affectionLevel`; a character with no relationship row renders a neutral default without error.
- [ ] Blurred backdrop does not intercept clicks and does not reduce message legibility (contrast holds on the dark theme).

## Done criteria
"Green" = the gesture-parser Vitest suite passes (matched / unmatched / nested / escaped / streaming-partial), the Playwright chat-gestures spec shows typing dots then a streamed reply with italic gestures and plain dialogue, user messages stay plain, and the AI-disclosure pill plus image/voice/safety rendering and the WS->SSE fallback are all verified unchanged. The model receives the gesture instruction via the output layer, marked as the interim home for the Phase 22 `{{GESTURE_STYLE_GUIDELINES}}` placeholder.

## Guardrail note
Do not commit, push, deploy, or run a non-local migration in this phase. This is a frontend render + a small additive prompt string; no schema change is required. Every commit, push, deploy, or non-local DB migration requires a fresh, explicit, per-action human approval. Stop and ask before any such action.
