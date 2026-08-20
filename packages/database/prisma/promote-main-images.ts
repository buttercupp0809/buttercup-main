// Atomic MAIN-image promoter. Reads a manifest produced by
// Plans/inference-aws/bulk_generate_main.py and, per character, in ONE
// transaction:
//   1. Creates the new CharacterMedia row for the fresh main image.
//   2. Clears isMain on every prior image row for that character.
//   3. Sets isMain=true on the new row.
//   4. Also sets isDisplay=true on the new row (and clears elsewhere) so
//      any read site that predates the isMain column still shows it.
//
// This is the single source of truth for the "exactly one isMain per
// character" invariant (see Plans/cursor-prompt/35-major-fixes-batch.md #C).
// Never edit the invariant in two places.
//
// Run: npx tsx packages/database/prisma/promote-main-images.ts <manifest.json>

import "./load-env";
import { readFileSync } from "node:fs";
import { prisma } from "@buttercupp/database";

interface ManifestItem {
  seedKey: string;
  personaIndex: number;
  prompt: string;
  s3Key: string | null;
}

interface Manifest {
  generatedAt: string;
  dryRun: boolean;
  items: ManifestItem[];
}

async function promoteOne(item: ManifestItem): Promise<{ ok: boolean; note: string }> {
  if (!item.s3Key) return { ok: false, note: "manifest item has no s3Key (dry-run entry?)" };

  const character = await prisma.character.findUnique({
    where: { seedKey: item.seedKey },
    select: { id: true, name: true },
  });
  if (!character) return { ok: false, note: `no character with seedKey=${item.seedKey}` };

  // The full swap runs in one transaction so a crash never leaves two
  // isMain rows or a period with none. Order matters: create the new row
  // first (so we have its id), then clear + set in bulk.
  await prisma.$transaction(async (tx) => {
    // Insert new. Sort uses Date.now() seconds so it lands at the end of
    // the gallery, same convention chat-image insertion uses. It stays
    // there even after demotion, so history remains ordered.
    const created = await tx.characterMedia.create({
      data: {
        characterId: character.id,
        kind: "image",
        url: item.s3Key!,
        isPrimary: false,
        isDisplay: false,
        isMain: false, // set below, after clearing
        sort: Math.floor(Date.now() / 1000),
      },
      select: { id: true },
    });

    // Demote every other main + display so the invariant holds.
    await tx.characterMedia.updateMany({
      where: { characterId: character.id, kind: "image", isMain: true, NOT: { id: created.id } },
      data: { isMain: false },
    });
    await tx.characterMedia.updateMany({
      where: { characterId: character.id, kind: "image", isDisplay: true, NOT: { id: created.id } },
      data: { isDisplay: false },
    });

    // Promote the new row atomically after demotion so a mid-transaction
    // read (there is none inside one tx, but be explicit) never sees zero
    // main rows.
    await tx.characterMedia.update({
      where: { id: created.id },
      data: { isMain: true, isDisplay: true },
    });
  });

  return { ok: true, note: `promoted ${item.s3Key} on ${character.name}` };
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("usage: tsx promote-main-images.ts <manifest.json>");
    process.exit(2);
  }
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.dryRun) {
    console.error("refusing to promote a dry-run manifest");
    process.exit(2);
  }

  let ok = 0;
  let failed = 0;
  for (const item of manifest.items) {
    try {
      const r = await promoteOne(item);
      if (r.ok) ok++;
      else failed++;
      console.log(`  [${r.ok ? "ok" : "skip"}] ${item.seedKey}: ${r.note}`);
    } catch (err) {
      failed++;
      console.error(`  [fail] ${item.seedKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n[promote] ok=${ok}, failed=${failed}, total=${manifest.items.length}`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("[promote] unexpected error:", err);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
}
