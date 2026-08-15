// Hides every CharacterMedia row that still points at a static
// /personas/N.{webp,png,jpg,...} seed file. Those files are stock/placeholder
// reference images only ever meant to seed face-consistency generation (see
// packages/database/prisma/seed.ts and sync-personas.ts); they were never
// produced by the real Juggernaut pipeline and must stop being shown once a
// real generated image exists.
//
// This is additive and reversible: rows are marked `hidden: true`, never
// deleted. The static files under frontend/public/personas stay on disk.
// See the HIDDEN MEDIA CONVENTION comment above `model CharacterMedia` in
// schema.prisma for the permanent rule this enforces (every display query
// must filter hidden: false).
//
// Idempotent: re-running only affects rows that are not already hidden, and
// running it twice in a row hides 0 additional rows the second time.
//
// Run: npx tsx prisma/hide-external-media.ts   (from packages/database/)

import "./load-env"; // must be first: sets DATABASE_URL before the singleton loads
import { prisma } from "@buttercupp/database";

// Every local seed image lives under /personas/ (see seed.ts's `listMedia`
// and sync-personas.ts's PUBLIC_PERSONAS constant). Matching on this prefix
// (rather than a specific extension) covers the .webp/.png mix actually on
// disk without needing to enumerate every file.
const EXTERNAL_PREFIX = "/personas/";

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("hide-external-media - DB unreachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  // Targets every row still needing a fix, not just `hidden: false`, so the
  // script is self-healing: it also clears isPrimary/isDisplay on rows that
  // were already hidden by an earlier run but still carried a stale flag.
  // The external reference image must never carry isPrimary or isDisplay
  // once hidden (both flags would let a hidden row win a display query that
  // forgets to filter hidden: false, defeating the whole point of hiding).
  const candidates = await prisma.characterMedia.findMany({
    where: {
      url: { startsWith: EXTERNAL_PREFIX },
      OR: [{ hidden: false }, { isPrimary: true }, { isDisplay: true }],
    },
    select: { id: true, characterId: true, url: true },
  });

  console.log(`[hide-external-media] found ${candidates.length} external reference row(s) needing a fix`);

  if (candidates.length > 0) {
    const result = await prisma.characterMedia.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { hidden: true, isPrimary: false, isDisplay: false },
    });
    console.log(`[hide-external-media] hid/cleared ${result.count} row(s)`);
  }

  const totalExternal = await prisma.characterMedia.count({
    where: { url: { startsWith: EXTERNAL_PREFIX } },
  });
  const totalExternalHidden = await prisma.characterMedia.count({
    where: { url: { startsWith: EXTERNAL_PREFIX }, hidden: true },
  });
  const totalExternalVisible = totalExternal - totalExternalHidden;
  const totalExternalStillFlagged = await prisma.characterMedia.count({
    where: {
      url: { startsWith: EXTERNAL_PREFIX },
      OR: [{ isPrimary: true }, { isDisplay: true }],
    },
  });

  console.log(
    `[hide-external-media] done: ${totalExternal} total external reference row(s), ${totalExternalHidden} hidden, ${totalExternalVisible} still visible`,
  );

  await prisma.$disconnect();

  if (totalExternalVisible > 0 || totalExternalStillFlagged > 0) {
    console.error(
      `[hide-external-media] ${totalExternalVisible} external reference row(s) remain visible, ${totalExternalStillFlagged} still carry isPrimary/isDisplay; this should never happen`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("hide-external-media unexpected error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
