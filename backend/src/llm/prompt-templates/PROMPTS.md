# ButterCupp prompt templates - fill-in guide

This directory holds the LLM system prompt in fill-in template form.
`prompts.ts` composes these files at chat time and passes the joined
string to the model. Editing a template in dev hot-reloads immediately;
prod caches the templates once at boot.

## Composition order

Files are joined with a blank line between layers, in this exact order:

1. `00-base-persona.md`
2. `10-gesture-format.md`
3. `20-character.md`      (runtime only, do not hand-edit values)
4. `30-relationship.md`   (runtime only, do not hand-edit values)
5. `40-memory.md`         (runtime only, RAG-injected)
6. `45-user-context.md`   (runtime only, do not hand-edit values)
7. `50-content-mode.md`   (optional; empty by default)
8. `60-safety.md`         (LOCKED; do not edit)
9. `70-output-rules.md`
10. `80-disclosure.md`    (LOCKED; do not edit)

Layer order is load-bearing. Safety sits AFTER the character so it always
overrides. Disclosure comes last so the SB 243 obligation is the final
instruction the model reads.

## Placeholder marker syntax

- `{{PASCAL_CASE}}` = a user-fillable slot. Paste your guideline text
  where it appears. An empty slot resolves to an empty string, which is
  the byte-safe default.
- `{{@RUNTIME_KEY}}` = a runtime value the composer injects
  (character personality, affection level, retrieved memories, etc.).
  Do NOT hand-edit these; they are filled at chat time.

## Where each guideline goes

| File | Slot | What to paste |
|---|---|---|
| `00-base-persona.md` | `{{BASE_PERSONA_GUIDELINES}}` | Global companion behavior that applies to every character (tone, pacing, refusal style, etc.). Start with a leading newline so it sits below the base identity sentence. |
| `10-gesture-format.md` | `{{GESTURE_STYLE_GUIDELINES}}` | Extra style notes for how gestures should read (voice, cadence, examples). The base rule already says: wrap gestures in `*asterisks*`, keep dialogue plain. |
| `50-content-mode.md` | `{{SFW_GUIDELINES}}` | Text that only applies when `contentRating === "sfw"`. |
| `50-content-mode.md` | `{{MATURE_GUIDELINES}}` | Text that only applies when `contentRating === "mature"`. |
| `70-output-rules.md` | `{{OUTPUT_GUIDELINES}}` | Extra rules for length, formatting, or things the model tends to over-do. |

## Rules

- No secrets, no API keys, no PII in ANY template file. The templates ship
  with the app and go to every model provider.
- Do NOT edit `60-safety.md`. It is locked by the loader; the substitution
  path is a no-op for that file. Changes here undermine SB 243 and the
  crisis protocol.
- Do NOT edit `80-disclosure.md`. The AI-disclosure text is required by
  SB 243 and mirrored by the UI pill.
- Runtime slots (`{{@...}}`) are filled by `prompts.ts`. If you need to
  change what runtime data reaches the prompt, edit `prompts.ts` /
  `persona-prompts.ts`, not the template file.
- Every edit here changes what the model sees for EVERY chat, so keep
  additions short and behavioral, not narrative.
