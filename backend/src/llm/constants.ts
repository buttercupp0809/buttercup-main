// Model IDs per provider. Kept in one file so a model swap is a single edit.
// ButterCupp's chat purpose favours the OpenRouter uncensored model for mature
// content and the premium Anthropic/OpenAI models for SFW + quality-critical
// flows. Extract/summary use the cheap tier of whichever provider serves.

export const MODELS = {
  // OpenRouter uncensored model for mature chat. Model slug lives here so a
  // swap does not touch provider.ts. Choose a currently-available slug at run
  // time (routing table is centralized in provider.ts).
  OPENROUTER_UNCENSORED_CHAT: "nousresearch/hermes-3-llama-3.1-70b",
  // Note: OpenRouter ":free" variants are frequently retired. Use the stable
  // paid slug (cheap 8B) so memory extraction/summary do not 404 and fall back.
  OPENROUTER_EXTRACT: "meta-llama/llama-3.1-8b-instruct",

  ANTHROPIC_CHAT: "claude-3-7-sonnet-latest",
  ANTHROPIC_EXTRACT: "claude-3-5-haiku-latest",

  OPENAI_CHAT: "gpt-4o-mini",
  OPENAI_EXTRACT: "gpt-4o-mini",
} as const;

// Hardcoded fallback string when every provider is down or unconfigured. Kept
// short and character-neutral so it does not embarrass any persona.
export const HARDCODED_FALLBACK_TEXT =
  "Sorry, I lost the thread for a second. Can you say that again?";
