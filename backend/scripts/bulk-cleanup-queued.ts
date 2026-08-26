// Delete orphaned bulk video jobs stuck in "queued" (no live BullMQ job, no
// output). Needed before re-running the bulk: the resume-guard skips characters
// that already have a queued/ready bulk asset, so leftover queued rows block a
// re-run. Targeted: only kind=video, status=queued, meta.source=bulk-batch.
// Runs against whatever DATABASE_URL backend/.env points at (prod if you swapped it).
//   npx tsx backend/scripts/bulk-cleanup-queued.ts
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.replace(/:\/\/[^:]+:[^@]+@/, "://***@").split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`target DB: ${host}`);
  const before = await prisma.mediaAsset.count({
    where: { kind: "video", status: "queued", meta: { path: ["source"], equals: "bulk-batch" } },
  });
  console.log(`orphaned queued bulk video assets: ${before}`);
  if (before === 0) {
    console.log("nothing to delete.");
    await prisma.$disconnect();
    return;
  }
  const del = await prisma.mediaAsset.deleteMany({
    where: { kind: "video", status: "queued", meta: { path: ["source"], equals: "bulk-batch" } },
  });
  console.log(`deleted: ${del.count}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
