// Pure, framework/IO-free helper: no @buttercupp/database import here on
// purpose, so create/context.tsx (a "use client" component) can import it
// directly without pulling Prisma/pg into the browser bundle.
import type { CharacterDraft, CreateCharacterInput } from "@buttercupp/shared";

const APPEARANCE_FIELDS = [
  "style",
  "traits",
  "stylePrompt",
  "negativePrompt",
  "referenceImageKeys",
] as const;

// True when any appearance-affecting field differs between the draft the
// edit wizard was seeded with and the draft the user is submitting. Used to
// decide whether an edit PATCH should also re-trigger image generation for
// the new version (Build step 7): a name/bio/personality-only edit should
// NOT burn a fresh set of creation images.
export function appearanceChanged(
  original: Partial<CreateCharacterInput> | null,
  next: CharacterDraft,
): boolean {
  if (!original) return false;
  for (const key of APPEARANCE_FIELDS) {
    if (JSON.stringify(original[key] ?? null) !== JSON.stringify(next[key] ?? null)) {
      return true;
    }
  }
  return false;
}
