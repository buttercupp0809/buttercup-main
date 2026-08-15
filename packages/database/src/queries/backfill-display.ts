// Phase 26: CharacterMedia.isDisplay selection + backfill logic. Lives in
// @buttercupp/database (like queries/characters.ts) so the pure selection
// rule is importable and unit-testable without running the CLI script under
// prisma/backfill-display-media.ts, and the DB-backed helpers use the Prisma
// singleton (never construct their own client).

import { prisma } from "../client";

export interface DisplayCandidate {
  id: string;
  isPrimary: boolean;
}

// `images` must already be ordered [sort asc, createdAt asc]. Picks the
// free/secondary asset as the display image:
//   - 2+ images: the NON-isPrimary image with the lowest sort (ties broken by
//     earliest createdAt via the caller's ordering) so the hero stays
//     paywalled.
//   - exactly 1 image: that single image is both hero and display.
//   - 0 images: nothing to pick.
export function pickDisplayMediaId(images: DisplayCandidate[]): string | null {
  if (images.length === 0) return null;
  if (images.length === 1) return images[0].id;
  const nonPrimary = images.filter((m) => !m.isPrimary);
  // Fall back to the full (still sorted) list in the pathological case where
  // every row is somehow isPrimary, so a display image is always chosen.
  const pool = nonPrimary.length > 0 ? nonPrimary : images;
  return pool[0].id;
}

export interface BackfillCharacterResult {
  characterId: string;
  displayCount: number;
  ok: boolean;
}

// Atomically (per character) clears isDisplay on every image row and sets it
// on the chosen one, so a crash never leaves zero or two display rows.
// Idempotent: the pick depends only on isPrimary/sort/createdAt, never on the
// current isDisplay value.
export async function backfillCharacterDisplay(characterId: string): Promise<BackfillCharacterResult> {
  // hidden: false is load-bearing here, not cosmetic: a hidden row (e.g. the
  // retired external reference image, see the HIDDEN MEDIA CONVENTION in
  // schema.prisma) must never be picked as the display winner even if its
  // sort/isPrimary would otherwise make it the top candidate.
  const images = await prisma.characterMedia.findMany({
    where: { characterId, kind: "image", hidden: false },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true, isPrimary: true },
  });
  const displayId = pickDisplayMediaId(images);
  if (!displayId) {
    return { characterId, displayCount: 0, ok: true };
  }

  await prisma.$transaction([
    prisma.characterMedia.updateMany({
      where: { characterId, kind: "image", isDisplay: true },
      data: { isDisplay: false },
    }),
    prisma.characterMedia.update({
      where: { id: displayId },
      data: { isDisplay: true },
    }),
  ]);

  const displayCount = await prisma.characterMedia.count({
    where: { characterId, kind: "image", isDisplay: true },
  });
  return { characterId, displayCount, ok: displayCount === 1 };
}

// Runs the backfill for every character that has at least one non-hidden
// image row (a character with only hidden images has nothing to backfill;
// backfillCharacterDisplay would just report displayCount: 0, ok: true).
export async function backfillAllCharacterDisplay(): Promise<BackfillCharacterResult[]> {
  const rows = await prisma.characterMedia.findMany({
    where: { kind: "image", hidden: false },
    distinct: ["characterId"],
    select: { characterId: true },
  });
  const results: BackfillCharacterResult[] = [];
  for (const { characterId } of rows) {
    results.push(await backfillCharacterDisplay(characterId));
  }
  return results;
}
