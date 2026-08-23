// Debug helper: show recent video MediaAssets (status + error) and the count of
// video CharacterMedia rows (what /reels reads). LOCAL DB ONLY.
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";

async function main() {
  const assets = await prisma.mediaAsset.findMany({
    where: { kind: "video" },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, status: true, s3Key: true, jobId: true, createdAt: true, meta: true, characterId: true },
  });
  console.log(`=== recent video MediaAssets (${assets.length}) ===`);
  for (const a of assets) {
    const meta = a.meta as Record<string, unknown> | null;
    const err = meta && typeof meta.error === "string" ? ` err="${meta.error}"` : "";
    console.log(
      `${a.createdAt.toISOString()}  status=${a.status}  job=${a.jobId ?? "-"}  s3=${a.s3Key ? "yes" : "no"}  char=${a.characterId ?? "-"}${err}`,
    );
  }
  const byStatus = await prisma.mediaAsset.groupBy({ by: ["status"], where: { kind: "video" }, _count: true });
  console.log("=== video assets by status ===", byStatus.map((s) => `${s.status}:${s._count}`).join("  "));

  const reelCount = await prisma.characterMedia.count({ where: { kind: "video" } });
  console.log(`=== CharacterMedia video rows (what /reels shows): ${reelCount} ===`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
