// End-to-end i2v check through the FIXED path: resolve a character's reference
// bytes (CharacterMedia-first) and run generateVideo -> box -> download. Proves
// the LoadImage error is gone and a real webm is produced. LOCAL.
//   npx tsx backend/scripts/wan-i2v-e2e.ts [characterId] [fast|balanced|max]
import path from "node:path";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { resolveCharacterReferenceBytes } from "../src/media/reference";
import { generateVideo } from "../src/media/video/providers";

const OUT = "/private/tmp/claude-501/-Users-kshitijpratap-Documents-Projects-poppy/598c8160-980e-483c-b01f-5019405593d6/scratchpad";

async function main() {
  const characterId = process.argv[2] ?? "ca43de60-db11-4c53-82f8-9505785f96b1";
  const preset = (process.argv[3] as "fast" | "balanced" | "max") ?? "fast";
  const bytes = await resolveCharacterReferenceBytes(characterId);
  console.log(`reference bytes: ${bytes ? bytes.length + " bytes" : "NULL (unresolvable)"}`);
  if (!bytes) process.exit(1);
  console.log(`rendering i2v preset=${preset} (this takes 1-4 min)...`);
  const out = await generateVideo({
    mode: "i2v",
    prompt: "she smiles warmly and waves at the camera, natural motion",
    negativePrompt: "blurry, distorted, deformed",
    referenceImageUrls: [],
    referenceBytes: bytes,
    seconds: 5,
    aspect: "portrait",
    preset,
  });
  const p = `${OUT}/e2e-i2v.webm`;
  writeFileSync(p, out.buffer);
  console.log(`DONE provider=${out.provider} bytes=${out.buffer.length} latencyMs=${out.latencyMs}`);
  console.log(`wrote ${p}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
