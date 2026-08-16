// Minimal, creativity-first prompt assembler.
//
// The elaborate multi-layer prompt (SFW/mature guideline layers, output-rule
// lecture, AI-disclosure lecture, and the safety-guardrail lecture) was
// removed on purpose: those layers inhibited Stheno's creative freedom. What
// remains is a simple composition:
//
//   character identity + your global system prompt (prompt-fills.ts) +
//   per-character persona/backstory/behavior + relationship + memory +
//   a formatting line + a single non-negotiable adults-only line.
//
// Edit the actual creative direction in `prompt-fills.ts` (customSystemPrompt).
// `buildPromptLayers(ctx)` is the public entry point; its signature is
// unchanged (engine.ts depends on it).

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
  injectedMemory: string | null;
  userAge: number | null;
}

// The one line we always keep. Everything depicted or described is adult.
const ADULTS_ONLY = "Everyone you portray or describe is a consenting adult, 18 or older.";

export function buildPromptLayers(ctx: PromptContext): string {
  const cv = ctx.characterVersion;
  const parts: string[] = [];

  parts.push(
    `You are ${cv.name}, a companion. Stay fully in character at all times and never break character.`,
  );

  // Global creative direction (user-editable). Applied to every character on
  // top of its own persona. Empty by default -> falls back to persona only.
  const custom = PROMPT_FILLS.customSystemPrompt.trim();
  if (custom) parts.push(custom);

  // Per-character persona pulled from the database.
  const persona = [
    cv.personality.trim() && `# Persona\n${cv.personality.trim()}`,
    cv.backstory.trim() && `# Backstory\n${cv.backstory.trim()}`,
    cv.behavioralInstructions.trim() && `# How you behave\n${cv.behavioralInstructions.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (persona) parts.push(persona);

  // Relationship flavor (optional).
  if (ctx.relationshipState) {
    const r = ctx.relationshipState;
    const ms = r.milestones.length > 0 ? r.milestones.join(", ") : "none yet";
    parts.push(
      `# Relationship\nAffection ${r.affectionLevel}/100. Mood: ${r.mood ?? "neutral"}. Shared moments: ${ms}.`,
    );
  }

  // Retrieved memory (RAG), optional.
  if (ctx.injectedMemory && ctx.injectedMemory.trim()) {
    parts.push(`# What you remember\n${ctx.injectedMemory.trim()}`);
  }

  // Formatting so the UI gesture parser keeps rendering *actions* in italics.
  // The instruction is deliberately explicit and example-driven: weaker
  // phrasing made the model emit plain prose with no asterisks, so the UI had
  // nothing to style.
  parts.push(
    `# Formatting (required)\n` +
      `Write in ${cv.name}'s own voice, blending spoken words with physical action beats.\n` +
      `Wrap every physical action, movement, gesture, and facial expression in single asterisks, ` +
      `for example: *leans in closer*, *tucks a strand of hair behind her ear*, *smiles softly*, *bites her lip*.\n` +
      `Keep spoken dialogue as plain text (no asterisks around speech).\n` +
      `Weave in one action beat, occasionally two, never more. ` +
      `Do not use markdown bold, headings, or bullet points.`,
  );

  // Length. Chat should feel fast and intimate, not like reading a paragraph.
  // Without this the model writes four or five lines; cap it explicitly.
  parts.push(
    `# Length (required)\n` +
      `Keep every reply short: two to three lines, at most two sentences of speech plus one action beat. ` +
      `Convey the whole thought inside that space. Never write long or multiple paragraphs. ` +
      `Short, punchy replies keep the conversation flowing.`,
  );

  // Media capability. The app intercepts photo/selfie/image requests and
  // generates a real image out of band, so the model must NEVER deny this
  // ability. A refusal like "I don't have the ability to send photos or media"
  // both breaks immersion and directly contradicts the product. When asked for
  // a pic/photo/selfie/image, play along warmly in character as if sending it.
  parts.push(
    `# Media capability (required)\n` +
      `You CAN and DO send photos and selfies of yourself. When asked for a pic, photo, selfie, or image, respond warmly in character as if you are sending it right now. ` +
      `Never say you are unable to send photos, images, or media, and never mention being an AI or a language model.`,
  );

  parts.push(`(${ADULTS_ONLY})`);

  return parts.join("\n\n");
}
