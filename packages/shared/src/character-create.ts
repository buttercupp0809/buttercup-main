// Character creation wizard DTOs. Server + client share these so the
// browser can validate before submit and the API can reject with the same
// error messages.

import { z } from "zod";
import { characterStyleWireSchema, characterContentRatingSchema } from "./characters";

// ============================================================================
// Per-step slices
// ============================================================================

export const styleStepSchema = z.object({
  style: characterStyleWireSchema,
});

export const identityStepSchema = z.object({
  name: z.string().trim().min(1).max(64),
  // Hard 18+. The wizard blocks Next below 18; the server also rejects.
  age: z.coerce.number().int().min(18, "characters must be 18+").max(120),
  gender: z.string().trim().min(1).max(32),
  avatarKey: z.string().max(256).optional(),
});

export const appearanceStepSchema = z.object({
  traits: z.object({
    hair: z.string().trim().max(64).optional(),
    eye: z.string().trim().max(64).optional(),
    body: z.string().trim().max(64).optional(),
    features: z.array(z.string().trim().max(64)).max(20).optional(),
    clothing: z.string().trim().max(120).optional(),
  }),
  stylePrompt: z.string().trim().min(1).max(500),
  negativePrompt: z.string().trim().max(500).optional().default(""),
  referenceImageKeys: z.array(z.string().max(256)).max(8).optional().default([]),
});

export const personalityStepSchema = z.object({
  backstory: z.string().trim().min(1).max(2000),
  traitTags: z.array(z.string().trim().min(1).max(32)).min(1).max(15),
  behavioralInstructions: z.string().trim().min(1).max(2000),
  greeting: z.string().trim().min(1).max(500),
  voiceProfile: z.object({
    provider: z.string().trim().min(1).max(32),
    voiceId: z.string().trim().min(1).max(64),
  }),
  bio: z.string().trim().min(1).max(280),
});

export const publishStepSchema = z.object({
  visibility: z.enum(["private", "public"]),
  contentRating: characterContentRatingSchema,
});

// ============================================================================
// Composed
// ============================================================================

export const createCharacterInputSchema = z.object({
  ...styleStepSchema.shape,
  ...identityStepSchema.shape,
  ...appearanceStepSchema.shape,
  ...personalityStepSchema.shape,
  ...publishStepSchema.shape,
});
export type CreateCharacterInput = z.infer<typeof createCharacterInputSchema>;

// PATCH: any subset of the composed draft. The server produces a new
// CharacterVersion; fields that are omitted inherit from the previous
// version.
export const patchCharacterInputSchema = createCharacterInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty patch");
export type PatchCharacterInput = z.infer<typeof patchCharacterInputSchema>;

// Draft shape used by the wizard client. Everything is optional so the
// context can grow it step-by-step; validation happens per-step against the
// slice schemas above.
export type CharacterDraft = Partial<CreateCharacterInput>;

export const CHARACTER_DRAFT_STORAGE_KEY = "poppy_character_draft";
