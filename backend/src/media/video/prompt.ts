// Deterministic video-prompt assembly from an AppearanceSheet. Same contract
// as image/prompt.ts: the character-defining fragment is stable across
// generations (that is what keeps the character looking consistent), and only
// the scene/motion derived from the user request varies.

import { SAFETY_NEGATIVE } from "./constants";
import { VIDEO_PROMPT_FILLS } from "./prompt-fills";

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

export interface BuildVideoPromptInput {
  appearanceSheet: AppearanceInput;
  style: "realistic" | "3d" | "anime";
  userRequest: string;
}

function serializeTraits(t: AppearanceInput["traits"]): string {
  const parts: string[] = [];
  if (t.hair) parts.push(`hair: ${t.hair}`);
  if (t.eye) parts.push(`eyes: ${t.eye}`);
  if (t.body) parts.push(`body: ${t.body}`);
  if (t.clothing) parts.push(`wearing ${t.clothing}`);
  if (t.features && t.features.length > 0)
    parts.push(`features: ${t.features.slice().sort().join(", ")}`);
  return parts.join(", ");
}

function styleFlavor(style: BuildVideoPromptInput["style"]): string {
  if (style === "realistic") return "photorealistic, cinematic lighting";
  if (style === "3d") return "stylized 3D render, PBR shading";
  return "anime illustration, cel shading";
}

export function buildVideoPrompt(input: BuildVideoPromptInput): {
  prompt: string;
  negativePrompt: string;
} {
  const traits = serializeTraits(input.appearanceSheet.traits);
  const flavor = styleFlavor(input.style);
  const scene = input.userRequest.trim();
  // Lead with the ACTION/motion. For i2v the still already fixes identity, so
  // the model's remaining job is motion; front-loading it (rather than burying
  // it after the identity/style fragment as before) makes Wan actually follow
  // what the user asked for. Identity traits follow as a light anchor, then
  // style, then the motion/quality tags.
  const positive = [
    scene && `${scene}`,
    input.appearanceSheet.stylePrompt.trim(),
    traits,
    flavor,
    VIDEO_PROMPT_FILLS.motionTags.trim(),
    VIDEO_PROMPT_FILLS.qualityTags.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  const negative = [
    input.appearanceSheet.negativePrompt.trim(),
    SAFETY_NEGATIVE,
    VIDEO_PROMPT_FILLS.negativeExtra.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  return { prompt: positive, negativePrompt: negative };
}
