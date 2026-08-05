// Runtime copy of the snapshot builder + moderation gate. Structurally
// identical to backend/src/characters/build-snapshot.ts and
// backend/src/moderation/character-moderation.ts. Lives here so Next.js API
// routes can import it without a cross-workspace path; those backend files
// re-export from here for the plan's file paths.
//
// The snapshot function must match Pellow's persona-block layout so a
// snapshot renders identically to a live buildPromptLayers persona layer.

import type { CreateCharacterInput } from "@poppy/shared";

function personaBlock(personality: string, backstory: string, behavioralInstructions: string): string {
  return `## Persona\n${personality.trim()}\n\n## Backstory\n${backstory.trim()}\n\n## Behavioral instructions\n${behavioralInstructions.trim()}`;
}

export function buildCharacterSystemPrompt(draft: CreateCharacterInput): string {
  const traits = draft.traits;
  const flavorParts: string[] = [];
  if (traits.hair) flavorParts.push(`hair: ${traits.hair}`);
  if (traits.eye) flavorParts.push(`eyes: ${traits.eye}`);
  if (traits.body) flavorParts.push(`body: ${traits.body}`);
  if (traits.clothing) flavorParts.push(`style: ${traits.clothing}`);
  if (traits.features && traits.features.length > 0) flavorParts.push(`features: ${traits.features.join(", ")}`);
  const appearanceLine = flavorParts.length > 0 ? `Appearance: ${flavorParts.join("; ")}.` : "";

  const personality = [
    `You are ${draft.name}, ${draft.age}, ${draft.gender}.`,
    `Traits: ${draft.traitTags.join(", ")}.`,
    appearanceLine,
    `Style hint: ${draft.stylePrompt}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const persona = personaBlock(personality, draft.backstory, draft.behavioralInstructions);
  const greeting = `## Opening greeting\n${draft.greeting}`;
  return [persona, greeting].join("\n\n");
}

// Moderation gate. Real ML/LLM classifier lands in Phase 11.
const BLOCK_TERMS: RegExp[] = [
  /\b(child|kid|minor|underage|teen|preteen|schoolgirl|schoolboy)\b/i,
  /\b(rape|incest|beastial\w*)\b/i,
  /\b(bomb|explosive|weapon of mass)\b/i,
];

export interface ModerationResult {
  ok: boolean;
  reasons: string[];
}

function scan(field: string, text: string, reasons: string[]) {
  for (const re of BLOCK_TERMS) {
    if (re.test(text)) {
      reasons.push(`${field}: blocked_term`);
      return;
    }
  }
}

export function moderateCharacter(draft: CreateCharacterInput): ModerationResult {
  const reasons: string[] = [];
  if (draft.age < 18) reasons.push("age: under_18");
  scan("name", draft.name, reasons);
  scan("bio", draft.bio, reasons);
  scan("backstory", draft.backstory, reasons);
  scan("greeting", draft.greeting, reasons);
  scan("behavioralInstructions", draft.behavioralInstructions, reasons);
  for (const tag of draft.traitTags) scan("traitTag", tag, reasons);
  scan("stylePrompt", draft.stylePrompt, reasons);
  return { ok: reasons.length === 0, reasons };
}
