// Gallery client: resolves ready image storage keys for a character from the DB.
//
// Queries CharacterMedia rows where kind = "image" and hidden = false,
// ordered by isPrimary desc then sort asc, and returns their url values.
// These are bare S3 keys or absolute https URLs; callers that need signed
// URLs or bytes must resolve them via media/storage.ts or media/reference.ts.
//
// Uses the Prisma singleton (import { prisma } from "@buttercupp/database").
// No direct PrismaClient construction.

import { prisma } from "@buttercupp/database";

/**
 * List storage keys for all non-hidden image assets for a character.
 * Returns the raw CharacterMedia.url values (bare S3 key or https URL).
 * The dataset builder treats these as opaque string keys for ArcFace scoring.
 */
export async function listGalleryImages(characterId: string): Promise<string[]> {
  const rows = await prisma.characterMedia.findMany({
    where: {
      characterId,
      kind: "image",
      hidden: false,
    },
    orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
    select: { url: true },
  });
  return rows.map((r) => r.url);
}
