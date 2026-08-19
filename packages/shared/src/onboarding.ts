// Onboarding wizard DTOs (Phase 24). Mirrors character-create.ts: per-step
// slice schemas plus a composed schema, shared by the client wizard and the
// completeOnboarding server action so both sides reject the same inputs.

import { z } from "zod";

export const ONBOARDING_DRAFT_STORAGE_KEY = "buttercupp:onboarding-draft";

// ============================================================================
// Per-step slices
// ============================================================================

// Step 1: identity
export const onboardingIdentitySchema = z.object({
  displayName: z.string().trim().min(1, "Tell us what to call you").max(48),
  gender: z.enum(["woman", "man", "nonbinary", "prefer_not"]),
});

// Step 2: taste / preferences
export const onboardingTasteSchema = z.object({
  vibe: z.enum(["cozy", "flirty", "adventurous", "intellectual", "supportive"]),
  interests: z.array(z.string().trim().min(1).max(32)).min(1, "Pick at least one").max(8),
});

// Step 3: optional first-companion pick (may be skipped)
export const onboardingPickSchema = z.object({
  firstCharacterId: z.string().uuid().nullable().optional(),
});

// ============================================================================
// Composed (finish). firstCharacterId stays optional/nullable.
// ============================================================================

export const onboardingInputSchema = onboardingIdentitySchema
  .merge(onboardingTasteSchema)
  .merge(onboardingPickSchema);

export type OnboardingDraft = Partial<z.infer<typeof onboardingInputSchema>>;
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;

// Bounded, human-labeled option lists for the step-2 UI. Gender and vibe are
// enums (never free text) so memory-hint seeding and future analytics stay
// clean; interests is a bounded suggested list, but the schema itself
// accepts any trimmed string up to 32 chars (not restricted to this list) so
// a user can type a custom interest chip.
export const ONBOARDING_GENDER_OPTIONS: { value: OnboardingInput["gender"]; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "prefer_not", label: "Prefer not to say" },
];

export const ONBOARDING_VIBE_OPTIONS: {
  value: OnboardingInput["vibe"];
  label: string;
  hint: string;
}[] = [
  { value: "cozy", label: "Cozy", hint: "Warm, gentle, easygoing" },
  { value: "flirty", label: "Flirty", hint: "Playful, teasing, romantic" },
  { value: "adventurous", label: "Adventurous", hint: "Bold, spontaneous, exciting" },
  { value: "intellectual", label: "Intellectual", hint: "Curious, deep, thoughtful" },
  { value: "supportive", label: "Supportive", hint: "Encouraging, caring, present" },
];

export const ONBOARDING_INTEREST_SUGGESTIONS: string[] = [
  "Movies",
  "Music",
  "Gaming",
  "Reading",
  "Fitness",
  "Cooking",
  "Travel",
  "Art",
  "Sci-fi",
  "Anime",
  "Fashion",
  "Outdoors",
];
