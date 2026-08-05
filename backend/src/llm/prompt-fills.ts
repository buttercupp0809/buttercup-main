// ============================================================================
// CHAT PROMPT FILL-INS  (edit these strings, nothing else)
// ============================================================================
//
// Every constant below is a placeholder for guideline text that gets injected
// into the layered system prompt at chat time. They ship EMPTY on purpose:
// an empty fill is byte-safe and the golden prompt tests lock that in. Paste
// your guidelines between the backticks and they take effect on the next turn.
//
// Where each one lands (see prompt-templates/PROMPTS.md for the full map):
//   basePersona   -> 00-base-persona.md   {{BASE_PERSONA_GUIDELINES}}
//   gestureStyle  -> 10-gesture-format.md  {{GESTURE_STYLE_GUIDELINES}}
//   sfw           -> 50-content-mode.md    {{SFW_GUIDELINES}}   (SFW chats only)
//   mature        -> 50-content-mode.md    {{MATURE_GUIDELINES}} (18+ chats only)
//   outputRules   -> 70-output-rules.md    {{OUTPUT_GUIDELINES}}
//
// Rules: no secrets / API keys / PII (these go to every model provider). Keep
// additions short and behavioral. `mature`/`sfw` are mutually exclusive per
// turn, chosen by the character's contentRating. Start multi-line fills with a
// leading newline so they sit below the fixed sentence above the slot.

export const PROMPT_FILLS = {
  // Global companion behavior applied to EVERY character.
  basePersona: ``,

  // Extra notes on how gestures should read (cadence, examples).
  gestureStyle: ``,

  // Applies only when the character is rated SFW.
  sfw: ``,

  // Applies only when the character is rated Mature (18+). This is where
  // uncensored-companion tone/consent/style guidance goes.
  mature: ``,

  // Extra output rules (length, formatting, habits to suppress).
  outputRules: ``,
} as const;
