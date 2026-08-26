// Where are my bulk videos? Prints the status of the bulk-batch video jobs and
// the newest video CharacterMedia rows with a playable local URL. Read-only.
//   npx tsx backend/scripts/bulk-video-status.ts
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";

async function main() {
  const bulk = await prisma.mediaAsset.findMany({
    where: { kind: "video", meta: { path: ["source"], equals: "bulk-batch" } },
    orderBy: { createdAt: "desc" },
  });
  const by = { queued: 0, processing: 0, ready: 0, failed: 0 } as Record<string, number>;
  for (const a of bulk) by[a.status] = (by[a.status] ?? 0) + 1;
  console.log(`\n=== bulk-batch video jobs (${bulk.length} total) ===`);
  console.log(`queued=${by.queued} processing=${by.processing} ready=${by.ready} failed=${by.failed}`);
  for (const a of bulk.slice(0, 10)) {
    console.log(`  ${a.createdAt.toISOString()}  ${a.status.padEnd(10)}  ${a.s3Key ?? "(no s3 yet)"}`);
  }

  const cms = await prisma.characterMedia.findMany({
    where: { kind: "video" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { character: { select: { name: true } } },
  });
  console.log(`\n=== newest video CharacterMedia rows (playable) ===`);
  if (cms.length === 0) console.log("  (none yet)");
  for (const m of cms) {
    console.log(`  ${(m.character?.name ?? "?").padEnd(16)}  http://localhost:3000/api/media?k=${encodeURIComponent(m.url)}`);
  }
  console.log("\nOpen a URL above to play, or browse http://localhost:3000/reels");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
