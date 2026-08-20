// Syncs the 144 personas from Plans/persona-list.md into the database.
// Owns persona identity via the new `seedKey` natural key (see Plans/cursor-prompt/
// 35-major-fixes-batch.md #A). seedKey = "persona-<index>" derived from the
// canonical seed image URL /personas/<index>.webp. This is what stops the
// duplicate-Character regressions: re-seeding is idempotent regardless of
// any canonical-name rename that used to make the old seed.ts create a
// second Character per persona.
//
// Run from repo root: npx tsx packages/database/prisma/sync-personas.ts

import "./load-env";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@buttercupp/database";

const PERSONAS_MD = path.join(__dirname, "..", "..", "..", "Plans", "persona-list.md");
const PUBLIC_PERSONAS = path.join(__dirname, "..", "..", "..", "frontend", "public", "personas");

interface ParsedPersona {
  index: number;
  name: string;
  location: string;
  bio: string;
}

function parsePersonaList(content: string): ParsedPersona[] {
  const result: ParsedPersona[] = [];
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(/^(\d+)\.\s+(.+?)\s+-\s+(.+)$/);
    if (match) {
      const index = parseInt(match[1], 10);
      const name = match[2].trim();
      const location = match[3].trim();
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;
      const bio = lines[i]?.trim() ?? "";
      result.push({ index, name, location, bio });
    }
    i++;
  }
  return result;
}

export function seedKeyForIndex(index: number): string {
  return `persona-${index}`;
}

async function main() {
  // Uses the @buttercupp/database singleton (CLAUDE.md hard rule: never new
  // PrismaClient() outside packages/database/src/client.ts). ./load-env is
  // imported at the top so DATABASE_URL is populated before the singleton
  // module initializes.
  console.log("[sync] Ensuring location column exists...");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "location" TEXT`,
  );

  const content = readFileSync(PERSONAS_MD, "utf-8");
  const personas = parsePersonaList(content);
  console.log(`[sync] Parsed ${personas.length} personas`);

  let updated = 0;
  let created = 0;
  let backfilled = 0;
  let skipped = 0;

  for (const p of personas) {
    const imageUrl = `/personas/${p.index}.webp`;
    const imagePath = path.join(PUBLIC_PERSONAS, `${p.index}.webp`);
    const seedKey = seedKeyForIndex(p.index);

    if (!existsSync(imagePath)) {
      console.log(`  [skip] ${p.index}. ${p.name} - image file not found`);
      skipped++;
      continue;
    }

    // Prefer the new stable seedKey. Fall back to matching by the legacy
    // primary /personas/N.webp media row so we can BACKFILL seedKey on
    // characters that predate the migration without creating a duplicate.
    // Only system-owned rows (ownerUserId = null) are candidates; a
    // user-created character with an accidental persona URL must never be
    // touched here.
    let existing = await prisma.character.findUnique({
      where: { seedKey },
      select: { id: true },
    });
    if (!existing) {
      const legacyMedia = await prisma.characterMedia.findFirst({
        where: {
          url: imageUrl,
          isPrimary: true,
          character: { ownerUserId: null },
        },
        select: { characterId: true },
      });
      if (legacyMedia) {
        existing = { id: legacyMedia.characterId };
        // Backfill seedKey on the pre-existing row. Guarded by the unique
        // index: if two legacy Characters somehow share this seed URL,
        // dedupe-characters.ts must run first to collapse them; this
        // update would otherwise throw P2002.
        await prisma.character.update({
          where: { id: legacyMedia.characterId },
          data: { seedKey },
        });
        backfilled++;
      }
    }

    if (existing) {
      await prisma.character.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          location: p.location,
          bio: p.bio,
          seedKey,
        },
      });
      updated++;
    } else {
      const character = await prisma.character.create({
        data: {
          name: p.name,
          location: p.location,
          bio: p.bio,
          age: 24,
          gender: "female",
          tags: ["playful", "confident"],
          style: "realistic",
          contentRating: "mature",
          visibility: "public",
          moderationStatus: "approved",
          popularityScore: 0,
          seedKey,
        },
      });
      // Single seeded image: both hero (isPrimary) and free/public (isDisplay),
      // same reasoning as seed.ts's single-image personas.
      await prisma.characterMedia.create({
        data: {
          characterId: character.id,
          kind: "image",
          url: imageUrl,
          isPrimary: true,
          isDisplay: true,
          sort: 0,
        },
      });
      created++;
    }

    if (p.index % 25 === 0) {
      console.log(`  ...${p.index}/${personas.length}`);
    }
  }

  console.log(
    `[sync] done: ${updated} updated, ${created} created, ${backfilled} seedKey backfilled, ${skipped} skipped`,
  );
  await prisma.$disconnect();
}

// Only run when invoked directly. seedKeyForIndex is exported for other
// scripts (bulk_generate_main.py's TS promoter, tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
