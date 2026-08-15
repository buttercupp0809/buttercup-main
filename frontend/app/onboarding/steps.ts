// Onboarding wizard step configuration. Mirrors the shape of
// ../(protected)/create/steps.ts exactly (including validateStep's logic,
// copied verbatim) so the wizard pattern stays identical across features.

import {
  onboardingIdentitySchema,
  onboardingTasteSchema,
  onboardingPickSchema,
  type OnboardingDraft,
} from "@buttercupp/shared";
import type { ZodTypeAny } from "zod";

export type OnboardingStepKey = "identity" | "taste" | "pick" | "finish";

export interface OnboardingStepConfig {
  key: OnboardingStepKey;
  label: string;
  path: string;
  schema: ZodTypeAny; // finish uses a passthrough (nothing to validate)
  optional?: boolean; // step 3 (pick) can be skipped
}

export const ONBOARDING_STEPS: OnboardingStepConfig[] = [
  { key: "identity", label: "You", path: "/onboarding/identity", schema: onboardingIdentitySchema },
  { key: "taste", label: "Taste", path: "/onboarding/taste", schema: onboardingTasteSchema },
  {
    key: "pick",
    label: "Match",
    path: "/onboarding/pick",
    schema: onboardingPickSchema,
    optional: true,
  },
  { key: "finish", label: "Finish", path: "/onboarding/finish", schema: onboardingPickSchema.partial() },
];

export function getStep(key: OnboardingStepKey): OnboardingStepConfig {
  const found = ONBOARDING_STEPS.find((s) => s.key === key);
  if (!found) throw new Error(`unknown step: ${key}`);
  return found;
}

export interface StepValidation {
  ok: boolean;
  fieldErrors: Record<string, string>;
}

// Runs the slice schema against the current draft. Returns per-field error
// messages so the UI can highlight the offending inputs. Copied verbatim
// (same logic) from ../(protected)/create/steps.ts.
export function validateStep(step: OnboardingStepConfig, draft: OnboardingDraft): StepValidation {
  const parsed = step.schema.safeParse(draft);
  if (parsed.success) return { ok: true, fieldErrors: {} };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}
