// Video-quality bench. Enqueue one Wan i2v clip for the first character whose
// reference image resolves, printing the LLM-expanded motion prompt so prompt
// engineering can be verified, then (with --wait) polls to completion and prints
// timing + s3Key for visual comparison. MANUAL tool; safe to delete.
//
// Usage:
//   npx tsx backend/scripts/video-quality-bench.ts --prompt "she types on a laptop and smiles" --seconds 5 --quality balanced --scene keep --wait
//
// Flags: --prompt <text> --seconds <3|5|8> --quality <fast|balanced|max>
//        --scene <keep|transform> --wait
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "@buttercupp/database";
import { createQueuedAsset } from "../src/media/asset";
import { enqueueMediaJob } from "../src/queue/media-queue";
import { expandVideoMotionPrompt } from "../src/media/video/prompt-expand";
import type { CreateVideoPayload } from "@buttercupp/shared";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const userRequest = arg("prompt", "she smiles softly and tucks a strand of hair behind her ear");
  const seconds = (Number(arg("seconds", "5")) || 5) as 3 | 5 | 8;
  const quality = arg("quality", "balanced") as "fast" | "balanced" | "max";
  const sceneMode = arg("scene", "keep") as "keep" | "transform";
  const wait = process.argv.includes("--wait");

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("no user");
  const { resolveCharacterReferenceBytes } = await import("../src/media/reference");
  const chars = await prisma.character.findMany({
    where: { currentVersion: { appearanceSheet: { isNot: null } } },
    orderBy: { createdAt: "asc" }, take: 80, select: { id: true, name: true },
  });
  let picked: { id: string; name: string } | null = null;
  for (const c of chars) {
    if (await resolveCharacterReferenceBytes(c.id)) { picked = c; break; }
  }
  if (!picked) throw new Error("no character with resolvable reference image");

  // Show the prompt-engineering result up front.
  const expanded = await expandVideoMotionPrompt(userRequest);
  console.log(`\ncharacter : ${picked.name} (${picked.id})`);
  console.log(`quality   : ${quality}  seconds: ${seconds}  scene: ${sceneMode}`);
  console.log(`userPrompt: ${userRequest}`);
  console.log(`expanded  : ${expanded}\n`);

  const payload: CreateVideoPayload = {
    userRequest, mode: "i2v", seconds, aspectRatio: "portrait", quality, sceneMode,
  };
  const asset = await createQueuedAsset({ userId: user.id, characterId: picked.id, kind: "video", meta: { source: "bench", payload } });
  await enqueueMediaJob({ mediaAssetId: asset.id, userId: user.id, conversationId: null, characterId: picked.id, kind: "video", tokenCost: 0, payload: payload as unknown as Record<string, unknown> });
  console.log(`ENQUEUED assetId=${asset.id}`);

  if (!wait) { return; }
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const a = await prisma.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true, s3Key: true } });
    const secs = Math.round((Date.now() - start) / 1000);
    console.log(`  [${secs}s] status=${a?.status}`);
    if (a?.status === "ready" || a?.status === "failed") {
      console.log(`\nRESULT status=${a?.status} s3Key=${a?.s3Key ?? "(none)"} wallClock=${secs}s`);
      break;
    }
    if (secs > 30 * 60) { console.log("timeout"); break; }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL", e); process.exit(1); });
