// Resolve the current viewer (visitor OR authenticated user) into the shape
// the gallery query builder expects. Never throws; visitor is the safe
// default.

import type { CharacterViewer } from "@poppy/database";
import { getCurrentUser } from "@/lib/auth";

export async function getViewer(): Promise<CharacterViewer> {
  try {
    const user = await getCurrentUser();
    if (!user) return { id: null, ageVerified: false };
    const ageVerified =
      user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    return { id: user.id, ageVerified };
  } catch {
    return { id: null, ageVerified: false };
  }
}
