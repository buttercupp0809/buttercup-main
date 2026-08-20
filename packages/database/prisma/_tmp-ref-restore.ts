// TEMP (delete after): restore the generation reference face to the canonical
// /personas seed. resolveCharacterReferenceBytes picks the isPrimary image as
// the reference. The cutover set isPrimary on the visible S3 lead; this moves
// isPrimary back onto the (hidden) canonical seed so in-chat + bulk generation
// stay on-model, while isDisplay/isMain keep the S3 image as the visible lead.
// SELECT-only unless --apply.
import { prisma } from "@buttercupp/database";
const APPLY = process.argv.includes("--apply");

async function main() {
  const chars = await prisma.character.findMany({
    where: { ownerUserId: null },
    select: {
      id: true, name: true,
      media: { where: { kind: "image" }, select: { id: true, url: true, sort: true, isPrimary: true } },
    },
  });
  let fixed = 0, noSeed = 0;
  for (const c of chars) {
    const seeds = c.media.filter((m) => m.url.startsWith("/personas/")).sort((a, b) => a.sort - b.sort);
    if (seeds.length === 0) { noSeed++; continue; }
    const seed = seeds[0];
    if (APPLY) {
      await prisma.$transaction([
        prisma.characterMedia.updateMany({ where: { characterId: c.id, kind: "image" }, data: { isPrimary: false } }),
        prisma.characterMedia.update({ where: { id: seed.id }, data: { isPrimary: true } }),
      ]);
    }
    fixed++;
  }
  console.log(`=== REF RESTORE ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
  console.log(`personas with canonical seed set as reference (isPrimary): ${fixed}`);
  console.log(`personas without a /personas seed row (skipped): ${noSeed}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
