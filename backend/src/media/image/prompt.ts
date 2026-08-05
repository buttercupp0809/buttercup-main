// Deterministic prompt assembly from an AppearanceSheet. The critical
// contract: the same sheet always produces the same core prompt fragment;
// only the scene/pose derived from the user request varies. That is the
// mechanism behind character consistency across generations (paired with
// IP-Adapter/LoRA conditioning at generation time).

import { SAFETY_NEGATIVE } from "./constants";
import { IMAGE_PROMPT_FILLS } from "./prompt-fills";

interface AppearanceInput {
  stylePrompt: string;
  negativePrompt: string;
  traits: {
    hair?: string;
    eye?: string;
    body?: string;
    features?: string[];
    clothing?: string;
  };
}

export interface BuildImagePromptInput {
  appearanceSheet: AppearanceInput;
  style: "realistic" | "3d" | "anime";
  userRequest: string;
}

// Serialize traits in a fixed key order so the same sheet always yields the
// same substring. Missing fields are simply omitted.
function serializeTraits(t: AppearanceInput["traits"]): string {
  const parts: string[] = [];
  if (t.hair) parts.push(`hair: ${t.hair}`);
  if (t.eye) parts.push(`eyes: ${t.eye}`);
  if (t.body) parts.push(`body: ${t.body}`);
  if (t.clothing) parts.push(`wearing ${t.clothing}`);
  if (t.features && t.features.length > 0) parts.push(`features: ${t.features.slice().sort().join(", ")}`);
  return parts.join(", ");
}

function styleFlavor(style: BuildImagePromptInput["style"]): string {
  // A non-empty fill overrides the built-in flavor for that style.
  const override = IMAGE_PROMPT_FILLS.styleFlavor[style];
  if (override) return override;
  if (style === "realistic") return "photorealistic, cinematic lighting";
  if (style === "3d") return "stylized 3D render, PBR shading";
  return "anime illustration, cel shading";
}

export function buildImagePrompt(input: BuildImagePromptInput): {
  prompt: string;
  negativePrompt: string;
} {
  const traits = serializeTraits(input.appearanceSheet.traits);
  const flavor = styleFlavor(input.style);
  const scene = input.userRequest.trim();
  const positive = [
    input.appearanceSheet.stylePrompt.trim(),
    traits,
    flavor,
    scene && `scene: ${scene}`,
    // Fillable quality tags land last so they never shift the deterministic
    // trait/style prefix that drives character consistency.
    IMAGE_PROMPT_FILLS.qualityTags.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  const negative = [
    input.appearanceSheet.negativePrompt.trim(),
    SAFETY_NEGATIVE,
    IMAGE_PROMPT_FILLS.negativeExtra.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  return { prompt: positive, negativePrompt: negative };
}

// A tiny in-character caption for the image bubble. Kept intentionally
// short; the chat text is where the character speaks in full.
export function buildImageCaption(userRequest: string): string {
  const clean = userRequest.trim();
  if (!clean) return "here you go";
  return `here's ${clean.replace(/^(a|an|the)\s+/i, "")}`.slice(0, 120);
}
