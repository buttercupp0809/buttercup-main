// Animate a real character image into a video ("bring the character alive")
// through the REAL provider chain (self-hosted Wan box if POPPY_WAN_URL is set,
// else Fal, else Replicate). Produces a PLAYABLE clip - not the mock placeholder.
//
// Usage:
//   npx tsx backend/scripts/wan-i2v-character.ts <image-file-or-url> ["motion prompt"]
//
// To render via Fal (no g6e box needed) set these first:
//   export FAL_KEY=<your fal key>
//   export FAL_VIDEO_MODEL=fal-ai/wan-i2v      # image-to-video Wan on Fal
//
// If POPPY_WAN_URL points at a real g6e box, it uses that instead automatically.

import { readFileSync, writeFileSync } from "node:fs";
import { generateVideo } from "../src/media/video/providers";
import { videoSelfHostConfigured } from "../src/media/video/constants";

const OUT = "/private/tmp/claude-501/-Users-kshitijpratap-Documents-Projects-poppy/598c8160-980e-483c-b01f-5019405593d6/scratchpad";

function toRef(arg: string): string {
  if (/^https?:\/\//i.test(arg)) return arg; // public URL: pass through
  // Local file: inline as a data URI (Fal accepts data URIs for image_url).
  const bytes = readFileSync(arg);
  const ext = arg.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${bytes.toString("base64")}`;
}

async function main() {
  const img = process.argv[2];
  const prompt = process.argv[3] ?? "she comes alive, smiles softly and waves at the camera, natural motion";
  if (!img) {
    console.error('Usage: npx tsx backend/scripts/wan-i2v-character.ts <image-file-or-url> ["motion prompt"]');
    process.exit(1);
  }

  const provider = videoSelfHostConfigured()
    ? "self-hosted Wan box (POPPY_WAN_URL)"
    : process.env.FAL_KEY && process.env.FAL_VIDEO_MODEL
      ? `Fal (${process.env.FAL_VIDEO_MODEL})`
      : process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_VIDEO_MODEL
        ? "Replicate"
        : null;

  if (!provider) {
    console.error(
      "No video provider configured. Set one of:\n" +
        "  - POPPY_WAN_URL (self-hosted g6e box), or\n" +
        "  - FAL_KEY + FAL_VIDEO_MODEL=fal-ai/wan-i2v (cloud, easiest), or\n" +
        "  - REPLICATE_API_TOKEN + REPLICATE_VIDEO_MODEL",
    );
    process.exit(1);
  }
  console.log(`reference: ${img.slice(0, 80)}${img.length > 80 ? "..." : ""}`);
  console.log(`prompt:    ${prompt}`);
  console.log(`provider:  ${provider}\n`);
  console.log("Rendering i2v (this takes ~1-8 min on a real model)...");

  // Default to the balanced preset (follows the prompt, ~2-4 min). Override with
  // WAN_PRESET=fast (~1 min, weak adherence) or WAN_PRESET=max (~8-15 min).
  const preset = (process.env.WAN_PRESET as "fast" | "balanced" | "max") ?? "balanced";
  console.log(`preset:    ${preset}`);
  const out = await generateVideo({
    mode: "i2v",
    prompt,
    negativePrompt: "blurry, distorted, deformed, extra limbs, low quality",
    referenceImageUrls: [toRef(img)],
    seconds: 5,
    preset,
  });

  const ext = out.provider === "comfywan" ? "webm" : "mp4";
  const path = `${OUT}/character-alive.${ext}`;
  writeFileSync(path, out.buffer);
  console.log(`\nDONE  provider=${out.provider}  ${out.buffer.length} bytes  latencyMs=${out.latencyMs}`);
  console.log(`clip: ${path}`);
  console.log(`open it:  open "${path}"`);
}
main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
