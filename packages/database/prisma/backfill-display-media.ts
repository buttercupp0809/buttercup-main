// Phase 26: CLI entrypoint for backfilling CharacterMedia.isDisplay so the
// free/public asset (not the isPrimary hero) is the one shown on every public
// surface. Selection + DB logic lives in
// packages/database/src/queries/backfill-display.ts (unit-testable there);
// this file is just the runnable wrapper with console output and exit codes.
//
// Self-checking: exits non-zero if any character that has image media ends up
// with a count of isDisplay images other than 1.
//
// Run: npm run backfill:display -w @buttercupp/database

import "./load-env"; // must be first: sets DATABASE_URL before the singleton loads
import { prisma, backfillAllCharacterDisplay } from "@buttercupp/database";

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("backfill:display - DB unreachable, aborting.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const results = await backfillAllCharacterDisplay();
  console.log(`[backfill:display] ${results.length} character(s) with image media`);
  for (const r of results) {
    console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.characterId} isDisplay=true count=${r.displayCount}`);
  }

  const failures = results.filter((r) => !r.ok);
  await prisma.$disconnect();

  console.log(
    `[backfill:display] done: ${results.length} character(s) processed, ${failures.length} failed self-check`,
  );
  if (failures.length > 0) {
    console.error(
      `[backfill:display] characters without exactly one display image: ${failures
        .map((f) => f.characterId)
        .join(", ")}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("backfill:display unexpected error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
