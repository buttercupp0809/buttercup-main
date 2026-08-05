// Read-only relationship snapshot. Phase 17 only surfaces this in the UI;
// writes stay in the chat pipeline. Returns null (never throws) when a row
// does not exist, so a fresh user + character pair renders cleanly.

import { prisma } from "@buttercupp/database";

export interface RelationshipSnapshot {
  affectionLevel: number;
  mood: string | null;
  milestones: string[];
}

export async function getRelationship(
  userId: string,
  characterId: string,
): Promise<RelationshipSnapshot | null> {
  try {
    const row = await prisma.relationshipState.findUnique({
      where: { userId_characterId: { userId, characterId } },
      select: { affectionLevel: true, mood: true, milestones: true },
    });
    if (!row) return null;
    return {
      affectionLevel: row.affectionLevel,
      mood: row.mood,
      milestones: row.milestones,
    };
  } catch {
    return null;
  }
}

// Pure helpers live in `@/lib/affection` so client components can import
// them without pulling `prisma` (and therefore `pg` -> `dns`) into the
// client bundle. Re-exported here for back-compat with existing callers.
export { clampAffection, affectionPercent } from "@/lib/affection";
