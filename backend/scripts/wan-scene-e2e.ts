// MANUAL TOOL. Renders against the live self-hosted box (which may be scaled to
// zero and incurs real GPU cost). NEVER run automatically or in CI.
//
// Invocation:
//   npx tsx backend/scripts/wan-scene-e2e.ts [characterId] [fast|balanced|max]
//
// Steps:
//   1. restyleFirstFrame: generates a new first frame with the requested
//      outfit/scene while preserving identity (Stage A).
//   2. generateVideo i2v: animates the restyled frame (Stage B/C).
//   3. Writes scene-frame.png and e2e-scene.webm to the scratchpad; prints
//      provider, bytes, latencyMs, and video meta (includes fps).

import path from "node:path";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { restyleFirstFrame } from "../src/media/video/restyle";
import { generateVideo } from "../src/media/video/providers";
import type { WanPreset } from "../src/media/video/constants";

const OUT =
  "/private/tmp/claude-501/-Users-kshitijpratap-Documents-Projects-poppy/598c8160-980e-483c-b01f-5019405593d6/scratchpad";

async function main(): Promise<void> {
  const characterId =
    process.argv[2] ?? "ca43de60-db11-4c53-82f8-9505785f96b1";
  const preset = (process.argv[3] as WanPreset) ?? "balanced";

  console.log(
    `restyle: characterId=${characterId} scene="wearing a blue dress, standing on a sunny beach at golden hour"`,
  );
  const restyled = await restyleFirstFrame({
    characterId,
    userRequest:
      "wearing a blue dress, standing on a sunny beach at golden hour",
    aspect: "portrait",
  });
  if (!restyled) {
    console.error(
      "restyleFirstFrame returned null (no reference image, character not found, or box unreachable)",
    );
    process.exit(1);
  }
  const framePath = `${OUT}/scene-frame.png`;
  writeFileSync(framePath, restyled);
  console.log(
    `restyled frame written to ${framePath} (${restyled.length} bytes) -- eyeball identity before proceeding`,
  );

  console.log(`rendering i2v preset=${preset} (this takes 1-4 min)...`);
  const out = await generateVideo({
    mode: "i2v",
    prompt:
      "she smiles and her hair moves gently in the breeze",
    negativePrompt: "blurry, distorted, deformed",
    referenceImageUrls: [],
    referenceBytes: restyled,
    seconds: 5,
    aspect: "portrait",
    preset,
  });

  const webmPath = `${OUT}/e2e-scene.webm`;
  writeFileSync(webmPath, out.buffer);
  console.log(
    `DONE provider=${out.provider} bytes=${out.buffer.length} latencyMs=${out.latencyMs}`,
  );
  console.log(`meta: ${JSON.stringify(out.meta ?? {})}`);
  console.log(`wrote ${webmPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
