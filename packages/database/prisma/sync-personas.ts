// Syncs the 144 personas from Plans/persona-list.md into the database.
// Matches existing characters by their primary image URL (/personas/N.webp),
// then updates name/location/bio. Creates new records for any missing ones.
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
  let skipped = 0;

  for (const p of personas) {
    const imageUrl = `/personas/${p.index}.webp`;
    const imagePath = path.join(PUBLIC_PERSONAS, `${p.index}.webp`);

    if (!existsSync(imagePath)) {
      console.log(`  [skip] ${p.index}. ${p.name} - image file not found`);
      skipped++;
      continue;
    }

    const media = await prisma.characterMedia.findFirst({
      where: { url: imageUrl, isPrimary: true },
      select: { characterId: true },
    });

    if (media) {
      await prisma.character.update({
        where: { id: media.characterId },
        data: {
          name: p.name,
          location: p.location,
          bio: p.bio,
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

  console.log(`[sync] done: ${updated} updated, ${created} created, ${skipped} skipped`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
