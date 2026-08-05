// Wizard step configuration. Each step declares which draft fields must be
// present + valid before Next unlocks, plus the Zod slice used for the
// stricter per-step validation. Mirrors the pattern in
// ../Pellow/frontend/app/onboard/steps.ts.

import {
  styleStepSchema,
  identityStepSchema,
  appearanceStepSchema,
  personalityStepSchema,
  publishStepSchema,
  type CharacterDraft,
} from "@buttercupp/shared";
import type { ZodTypeAny } from "zod";

export type StepKey = "style" | "identity" | "appearance" | "personality" | "publish";

export interface CharacterStepConfig {
  key: StepKey;
  label: string;
  path: string;
  requiredFields: (keyof CharacterDraft)[];
  schema: ZodTypeAny;
}

export const CHARACTER_STEPS: CharacterStepConfig[] = [
  {
    key: "style",
    label: "Style",
    path: "/create/style",
    requiredFields: ["style"],
    schema: styleStepSchema,
  },
  {
    key: "identity",
    label: "Identity",
    path: "/create/identity",
    requiredFields: ["name", "age", "gender"],
    schema: identityStepSchema,
  },
  {
    key: "appearance",
    label: "Appearance",
    path: "/create/appearance",
    requiredFields: ["stylePrompt", "traits"],
    schema: appearanceStepSchema,
  },
  {
    key: "personality",
    label: "Personality",
    path: "/create/personality",
    requiredFields: [
      "backstory",
      "traitTags",
      "behavioralInstructions",
      "greeting",
      "voiceProfile",
      "bio",
    ],
    schema: personalityStepSchema,
  },
  {
    key: "publish",
    label: "Publish",
    path: "/create/publish",
    requiredFields: ["visibility", "contentRating"],
    schema: publishStepSchema,
  },
];

export function getStep(key: StepKey): CharacterStepConfig {
  const found = CHARACTER_STEPS.find((s) => s.key === key);
  if (!found) throw new Error(`unknown step: ${key}`);
  return found;
}

export interface StepValidation {
  ok: boolean;
  fieldErrors: Record<string, string>;
}

// Runs the slice schema against the current draft. Returns per-field error
// messages so the UI can highlight the offending inputs. The identity
// step's `.min(18)` on age propagates through this same code path.
export function validateStep(step: CharacterStepConfig, draft: CharacterDraft): StepValidation {
  // Zod's safeParse against a partial draft returns issues for missing
  // required fields as well as invalid values, which is exactly what the UI
  // needs to gate Next.
  const parsed = step.schema.safeParse(draft);
  if (parsed.success) return { ok: true, fieldErrors: {} };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}
