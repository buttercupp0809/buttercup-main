// READ-ONLY: contact sheet of Leyla's non-hidden images/* candidates.
import { prisma } from "@buttercupp/database";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const OUT = "/private/tmp/claude-501/-Users-kshitijpratap-Documents-Projects-poppy/a3d6fd29-27a5-44ec-a733-521afefc03df/scratchpad";
const CHAR = "e3f954dd-572a-44c4-98d2-10373c79dad7";
const BAD = "b4903974-cd4d-49c9-a6a6-ed33b782a697";
const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-north-1" });
const IW = 220, IH = 293, LABEL = 26, CW = IW, CH = IH + LABEL, COLS = 6;

async function thumb(key: string): Promise<Buffer | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: "poppy-generated", Key: key }));
    return await sharp(Buffer.from(await r.Body!.transformToByteArray())).resize(IW, IH, { fit: "cover" }).toBuffer();
  } catch { return null; }
}
const lbl = (t: string, bad: boolean) => Buffer.from(`<svg width="${CW}" height="${LABEL}"><rect width="${CW}" height="${LABEL}" fill="${bad ? "#900" : "#111"}"/><text x="5" y="18" font-size="12" fill="#fff" font-family="sans-serif">${t}</text></svg>`);

async function main() {
  const media = await prisma.characterMedia.findMany({
    where: { characterId: CHAR, kind: "image", hidden: false, url: { startsWith: "images/" } },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true, url: true },
  });
  writeFileSync(`${OUT}/leyla-candidates.json`, JSON.stringify(media, null, 2));
  const rows = Math.ceil(media.length / COLS);
  const canvas = sharp({ create: { width: COLS * CW, height: rows * CH, channels: 3, background: "#333" } });
  const comps: sharp.OverlayOptions[] = [];
  for (let i = 0; i < media.length; i++) {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    const isBad = media[i].url.includes(BAD);
    const t = await thumb(media[i].url);
    comps.push({ input: t ?? Buffer.from(`<svg width="${IW}" height="${IH}"><rect width="${IW}" height="${IH}" fill="#222"/></svg>`), left: x, top: y + LABEL });
    comps.push({ input: lbl(`c${i}${isBad ? " CURRENT/BAD" : ""}`, isBad), left: x, top: y });
  }
  await canvas.composite(comps).png().toFile(`${OUT}/leyla-sheet.png`);
  console.log(`Leyla images/* candidates: ${media.length} -> leyla-sheet.png`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
