// READ-ONLY: resolve the image key -> character, and scope PNG->WebP work.
import { prisma } from "@buttercupp/database";

const KEY_FRAGMENT = "b4903974-cd4d-49c9-a6a6-ed33b782a697";

async function main() {
  // 1) Which character(s) own media with this key?
  const media = await prisma.characterMedia.findMany({
    where: { url: { contains: KEY_FRAGMENT } },
    select: {
      id: true, url: true, isMain: true, isDisplay: true, isPrimary: true, hidden: true,
      character: {
        select: {
          id: true, name: true, ownerUserId: true, visibility: true,
          _count: { select: { conversations: true, media: true } },
        },
      },
    },
  });
  console.log("=== media matching key fragment ===");
  for (const m of media) {
    console.log(`media ${m.id} url=${m.url}`);
    console.log(`  flags: isMain=${m.isMain} isDisplay=${m.isDisplay} isPrimary=${m.isPrimary} hidden=${m.hidden}`);
    console.log(`  character: ${m.character.name} (${m.character.id}) system=${m.character.ownerUserId === null} visibility=${m.character.visibility} conversations=${m.character._count.conversations} media=${m.character._count.media}`);
  }
  if (media.length === 0) console.log("  (no media row matches this key)");

  // 2) Scope of PNG vs WebP among generated image media.
  const shapes = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       count(*) FILTER (WHERE url ILIKE '%.png')::int AS png,
       count(*) FILTER (WHERE url ILIKE '%.webp')::int AS webp,
       count(*) FILTER (WHERE url NOT ILIKE '%.png' AND url NOT ILIKE '%.webp')::int AS other,
       count(*)::int AS total
     FROM "CharacterMedia" WHERE kind='image' AND url LIKE 'images/%'`,
  );
  console.log("\n=== images/* media by extension ===", shapes[0]);

  // 3) Of the 143 current MAIN images, how many are PNG?
  const mains = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*) FILTER (WHERE url ILIKE '%.png')::int AS main_png,
            count(*)::int AS main_total
     FROM "CharacterMedia" WHERE "isMain"=true AND kind='image'`,
  );
  console.log("=== isMain images by extension ===", mains[0]);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
