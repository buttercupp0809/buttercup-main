// Debug: for a character, resolve its reference image key -> signed URL -> fetch
// and report whether the bytes are a real image (what the Wan i2v LoadImage
// needs). LOCAL DB ONLY.
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";
import { getSignedUrl } from "../src/media/storage";

async function main() {
  const charId = process.argv[2] ?? "ca43de60-db11-4c53-82f8-9505785f96b1";
  const char = await prisma.character.findUnique({
    where: { id: charId },
    include: { currentVersion: { include: { appearanceSheet: true } } },
  });
  const keys = char?.currentVersion?.appearanceSheet?.referenceImageKeys ?? [];
  console.log("character:", char?.name, "referenceImageKeys:", keys);
  for (const k of keys.slice(0, 2)) {
    try {
      const url = await getSignedUrl(k, 300);
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const magic = buf.subarray(0, 12).toString("hex");
      const isPng = magic.startsWith("89504e47");
      const isJpg = magic.startsWith("ffd8ff");
      const isWebp = buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
      console.log(`\nkey=${k}`);
      console.log(`  signed=${url.slice(0, 110)}`);
      console.log(`  http=${res.status} ct=${res.headers.get("content-type")} bytes=${buf.length}`);
      console.log(`  magic=${magic}  image=${isPng ? "PNG" : isJpg ? "JPEG" : isWebp ? "WEBP" : "NOT-AN-IMAGE"}`);
      if (!isPng && !isJpg && !isWebp) console.log(`  head="${buf.subarray(0, 120).toString("utf8").replace(/\s+/g, " ")}"`);
    } catch (e) {
      console.log(`  key=${k} ERROR ${e instanceof Error ? e.message : e}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
