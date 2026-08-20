// Convert generated PNGs to WebP in prod. For each CharacterMedia with an
// images/*.png url: download from poppy-generated, sharp->webp (q82), upload
// images/<uuid>.webp, and repoint the media.url. Keeps the old PNG object
// (non-destructive; a separate cleanup can prune later). Idempotent: only
// touches .png rows. SELECT+S3 GET only unless --apply.
import { prisma } from "@buttercupp/database";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const BUCKET = "poppy-generated";
const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-north-1" });
const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

async function main() {
  let rows = await prisma.characterMedia.findMany({
    where: { kind: "image", url: { startsWith: "images/", endsWith: ".png" } },
    select: { id: true, url: true },
    orderBy: { createdAt: "asc" },
  });
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);
  console.log(`=== WEBP CONVERT ${APPLY ? "APPLY" : "DRY-RUN"} === png rows: ${rows.length}`);
  if (!APPLY) {
    rows.slice(0, 5).forEach((r) => console.log(`  ${r.url} -> ${r.url.replace(/\.png$/i, ".webp")}`));
    await prisma.$disconnect();
    return;
  }
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const newKey = r.url.replace(/\.png$/i, ".webp");
    try {
      const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: r.url }));
      const png = Buffer.from(await got.Body!.transformToByteArray());
      const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: newKey, Body: webp, ContentType: "image/webp" }));
      await prisma.characterMedia.update({ where: { id: r.id }, data: { url: newKey } });
      ok++;
    } catch (e) {
      fail++;
      console.log(`  [fail] ${r.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${rows.length} (ok=${ok} fail=${fail})`);
  }
  console.log(`done: converted=${ok}, failed=${fail}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
