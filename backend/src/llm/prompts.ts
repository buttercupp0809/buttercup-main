// Deterministic prompt assembler. Every editable literal now lives in
// `prompt-templates/*.md`; this file only composes runtime values into
// those templates and joins them in the historical, byte-equivalent
// order. `buildPromptLayers(ctx)` is the public entry point and its
// signature is unchanged (engine.ts depends on it).
//
// Layer order (PRD §10, load-bearing):
//   identity/base -> character (persona/backstory/behavioral + state) ->
//   relationship -> memory -> user context -> output rules (with gesture
//   format appended) -> safety -> disclosure.
//
// Safety sits below the character so it always overrides; disclosure is
// last so the SB 243 obligation is the final instruction the model reads.
// The composed output for a fixed context is byte-equivalent to the
// pre-Phase-22 output; `__tests__/prompts.golden.test.ts` locks this in.

import { MEMORY_PLACEHOLDER } from "./persona-prompts";
import { render, TEMPLATE_NAMES } from "./prompt-templates/loader";
import { PROMPT_FILLS } from "./prompt-fills";
import type { ContentRating } from "@buttercupp/database";

export interface PromptContext {
  characterVersion: {
    name: string;
    personality: string;
    backstory: string;
    behavioralInstructions: string;
  };
  contentRating: ContentRating;
  relationshipState: {
    affectionLevel: number;
    mood: string | null;
    milestones: string[];
  } | null;
  // Phase 05 fills this in. Null for now.
  injectedMemory: string | null;
  userAge: number | null;
}

// Sentinel guarantees the compose order table below always uses a name
// that exists in the loader manifest, so a typo becomes a type error.
type Known = (typeof TEMPLATE_NAMES)[number];
function t(name: Known): Known {
  return name;
}

function contentRatingLabel(r: ContentRating): string {
  return r === "mature"
    ? "Mature (18+, explicit content permitted when initiated by the user)"
    : "SFW";
}

function userLine(userAge: number | null): string {
  return userAge !== null
    ? `User is ${userAge} years old.`
    : "User is an adult member of ButterCupp (18+).";
}

export function buildPromptLayers(ctx: PromptContext): string {
  const rel = ctx.relationshipState ?? { affectionLevel: 0, mood: null, milestones: [] };
  const milestonesLine = rel.milestones.length > 0 ? rel.milestones.join(", ") : "(none)";

  // Layer 1: identity + base companion. Template holds the fixed IDENTITY
  // line plus a {{BASE_PERSONA_GUIDELINES}} slot (filled from prompt-fills.ts,
  // empty by default).
  const identity = `# Identity\n${render("00-base-persona", {
    BASE_PERSONA_GUIDELINES: PROMPT_FILLS.basePersona,
  })}`;

  // Layer 2: character (persona + backstory + behavioral + state). One
  // template holds all four subheadings so byte-equivalence with the
  // pre-refactor `personaBlock` + `characterStateBlock` join is exact.
  const character = render(t("20-character"), {
    "@PERSONALITY": ctx.characterVersion.personality.trim(),
    "@BACKSTORY": ctx.characterVersion.backstory.trim(),
    "@BEHAVIORAL_INSTRUCTIONS": ctx.characterVersion.behavioralInstructions.trim(),
    "@NAME": ctx.characterVersion.name,
    "@CONTENT_RATING_LABEL": contentRatingLabel(ctx.contentRating),
  });

  const relationship = render(t("30-relationship"), {
    "@AFFECTION_LEVEL": String(rel.affectionLevel),
    "@MOOD": rel.mood ?? "neutral",
    "@MILESTONES": milestonesLine,
  });

  // Memory: retrieved-memory RAG slot. Fills from `injectedMemory` when
  // available, falls back to the historical placeholder so Phase 05's
  // wiring keeps working end to end.
  const memory = render(t("40-memory"), {
    "@MEMORY_BODY": ctx.injectedMemory ?? MEMORY_PLACEHOLDER,
  });

  const user = render(t("45-user-context"), {
    "@USER_LINE": userLine(ctx.userAge),
  });

  // Content-mode: user-editable SFW/MATURE guideline slots. Only the
  // branch matching the current rating gets a chance to render text;
  // both empty resolves to "" and the layer is dropped from the join
  // (preserves byte equivalence with the pre-refactor output, which had
  // no separate content-mode block).
  const contentModeValues: Record<string, string> =
    ctx.contentRating === "mature"
      ? { MATURE_GUIDELINES: PROMPT_FILLS.mature, SFW_GUIDELINES: "" }
      : { MATURE_GUIDELINES: "", SFW_GUIDELINES: PROMPT_FILLS.sfw };
  const contentMode = render(t("50-content-mode"), contentModeValues).trim();

  // Output layer: general rules + the gesture-format reminder. `render`
  // strips the single trailing newline on each template, so joining with
  // "\n" between them reproduces today's `${OUTPUT_RULES}\n${GESTURE_FORMAT}`.
  const output = `${render(t("70-output-rules"), {
    OUTPUT_GUIDELINES: PROMPT_FILLS.outputRules,
  })}\n${render(t("10-gesture-format"), {
    GESTURE_STYLE_GUIDELINES: PROMPT_FILLS.gestureStyle,
  })}`;

  // Locked layers: loader ignores substitutions here (see LOCKED_TEMPLATES).
  const safety = render(t("60-safety"));
  const disclosure = render(t("80-disclosure"));

  const layers: string[] = [
    identity,
    character,
    relationship,
    memory,
    user,
    ...(contentMode.length > 0 ? [contentMode] : []),
    output,
    safety,
    disclosure,
  ];
  return layers.join("\n\n");
}
