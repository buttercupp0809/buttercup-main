// MANUAL admin tool. Requires the media worker running AND the Wan + image GPU boxes UP.
// Enqueuing the full batch is ~30-40h of serial GPU time and real cost.
// NEVER run in CI or automatically. Dry-run by default; --validate-one to time one render;
// --all --confirm to launch the full batch.
//
// Usage:
//   npx tsx backend/scripts/bulk-generate-videos.ts                   # dry-run (default)
//   npx tsx backend/scripts/bulk-generate-videos.ts --validate-one    # enqueue 1, poll to done
//   npx tsx backend/scripts/bulk-generate-videos.ts --all --confirm   # enqueue all eligible
//   npx tsx backend/scripts/bulk-generate-videos.ts --all --confirm --limit 10  # cap at 10

import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "@buttercupp/database";
import { createQueuedAsset } from "../src/media/asset";
import { enqueueMediaJob } from "../src/queue/media-queue";
import { scenarioForIndex } from "../src/media/video/bulk-scenarios";
import type { CreateVideoPayload } from "@buttercupp/shared";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flagAll = argv.includes("--all");
const flagConfirm = argv.includes("--confirm");
const flagValidateOne = argv.includes("--validate-one");
const limitIdx = argv.indexOf("--limit");
const limitN: number | null = limitIdx !== -1 ? parseInt(argv[limitIdx + 1] ?? "", 10) : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildPayload(i: number): CreateVideoPayload {
  const scenario = scenarioForIndex(i);
  return {
    userRequest: scenario.prompt,
    mode: "i2v",
    seconds: 5,
    aspectRatio: "portrait",
    quality: "balanced",
    sceneMode: "transform",
  };
}

async function resolveAdminUserId(): Promise<string> {
  if (process.env.ADMIN_USER_ID) return process.env.ADMIN_USER_ID;
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    console.error("ERROR: no users found in the database and ADMIN_USER_ID is not set.");
    process.exit(1);
  }
  return user.id;
}

async function hasExistingBatchVideo(characterId: string): Promise<boolean> {
  const existing = await prisma.mediaAsset.findFirst({
    where: {
      characterId,
      kind: "video",
      meta: { path: ["source"], equals: "bulk-batch" },
      status: { in: ["queued", "processing", "ready"] },
    },
  });
  return existing !== null;
}

async function resolveBytes(characterId: string): Promise<boolean> {
  // Dynamic import to avoid loading S3/storage env until after dotenv is applied.
  const { resolveCharacterReferenceBytes } = await import("../src/media/reference");
  const bytes = await resolveCharacterReferenceBytes(characterId);
  return bytes !== null;
}

async function enqueueOne(
  userId: string,
  characterId: string,
  i: number,
): Promise<string> {
  const payload = buildPayload(i);
  const scenario = scenarioForIndex(i);
  const asset = await createQueuedAsset({
    userId,
    characterId,
    kind: "video",
    meta: { source: "bulk-batch", scenarioTitle: scenario.title, payload },
  });
  await enqueueMediaJob({
    mediaAssetId: asset.id,
    userId,
    conversationId: null,
    characterId,
    kind: "video",
    tokenCost: 0,
    payload: payload as unknown as Record<string, unknown>,
  });
  return asset.id;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function dryRun(): Promise<void> {
  const characters = await prisma.character.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let eligible = 0;
  let skippedNoImage = 0;
  let skippedAlreadyDone = 0;

  // Preview table (first 12 scenario rotations)
  const PREVIEW_COUNT = Math.min(12, characters.length);
  console.log("\nScenario rotation preview (first 12 characters):");
  console.log("  idx | character name                   | scenario title");
  console.log("  ----|----------------------------------|---------------------");
  for (let i = 0; i < PREVIEW_COUNT; i++) {
    const c = characters[i];
    const scenario = scenarioForIndex(i);
    const name = (c.name ?? "(unnamed)").padEnd(32).slice(0, 32);
    console.log(`  ${String(i).padStart(3)} | ${name} | ${scenario.title}`);
  }

  // Eligibility scan
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const alreadyDone = await hasExistingBatchVideo(c.id);
    if (alreadyDone) {
      skippedAlreadyDone++;
      continue;
    }
    const hasImage = await resolveBytes(c.id);
    if (!hasImage) {
      skippedNoImage++;
      continue;
    }
    eligible++;
  }

  const total = characters.length;
  console.log("\nBatch plan summary:");
  console.log(`  Total characters  : ${total}`);
  console.log(`  Eligible to enqueue: ${eligible}`);
  console.log(`  Skipped (no image): ${skippedNoImage}`);
  console.log(`  Skipped (already batched): ${skippedAlreadyDone}`);
  console.log(`\nCost/time estimate: ${eligible} x 8s max render ~= ${Math.round(eligible * 17 / 60)} h serial GPU time on the g6e box.`);
  console.log("\nThis was a DRY RUN. Nothing was enqueued.");
  console.log("To enqueue: npx tsx backend/scripts/bulk-generate-videos.ts --all --confirm");
}

async function validateOne(): Promise<void> {
  const userId = await resolveAdminUserId();
  const characters = await prisma.character.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let firstEligibleIdx = -1;
  let firstEligibleChar: (typeof characters)[number] | null = null;

  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const alreadyDone = await hasExistingBatchVideo(c.id);
    if (alreadyDone) continue;
    const hasImage = await resolveBytes(c.id);
    if (!hasImage) continue;
    firstEligibleIdx = i;
    firstEligibleChar = c;
    break;
  }

  if (!firstEligibleChar || firstEligibleIdx === -1) {
    console.error("ERROR: no eligible character found (all skipped or already done).");
    process.exit(1);
  }

  const scenario = scenarioForIndex(firstEligibleIdx);
  console.log(`\nValidating single render:`);
  console.log(`  Character: ${firstEligibleChar.name ?? firstEligibleChar.id} (index ${firstEligibleIdx})`);
  console.log(`  Scenario : ${scenario.title}`);

  const startMs = Date.now();
  const assetId = await enqueueOne(userId, firstEligibleChar.id, firstEligibleIdx);
  console.log(`  Enqueued assetId: ${assetId}`);
  console.log(`  Polling every 5s (cap 30 min)...`);

  const CAP_MS = 30 * 60 * 1000;
  let asset: { status: string; s3Key: string | null } | null = null;

  while (Date.now() - startMs < CAP_MS) {
    await new Promise((r) => setTimeout(r, 5000));
    asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { status: true, s3Key: true },
    });
    if (!asset) { console.error("Asset disappeared from DB."); process.exit(1); }
    console.log(`  [${Math.round((Date.now() - startMs) / 1000)}s] status=${asset.status}`);
    if (asset.status === "ready" || asset.status === "failed") break;
  }

  const elapsedSec = Math.round((Date.now() - startMs) / 1000);
  console.log(`\nResult: status=${asset?.status} s3Key=${asset?.s3Key ?? "(none)"} wallClock=${elapsedSec}s`);
  if (asset?.status !== "ready") {
    console.error("Render did not complete successfully. Fix the worker/GPU before running --all.");
    process.exit(1);
  }
}

async function runAll(): Promise<void> {
  const userId = await resolveAdminUserId();
  const characters = await prisma.character.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let enqueued = 0;
  let skippedNoImage = 0;
  let skippedAlreadyDone = 0;

  for (let i = 0; i < characters.length; i++) {
    if (limitN !== null && enqueued >= limitN) {
      console.log(`\n--limit ${limitN} reached. Stopping.`);
      break;
    }

    const c = characters[i];
    const alreadyDone = await hasExistingBatchVideo(c.id);
    if (alreadyDone) {
      console.log(`  [${i}] SKIP (already batched) ${c.id} ${c.name ?? ""}`);
      skippedAlreadyDone++;
      continue;
    }
    const hasImage = await resolveBytes(c.id);
    if (!hasImage) {
      console.log(`  [${i}] SKIP (no image) ${c.id} ${c.name ?? ""}`);
      skippedNoImage++;
      continue;
    }

    const scenario = scenarioForIndex(i);
    const assetId = await enqueueOne(userId, c.id, i);
    enqueued++;
    console.log(`  [${i}] ENQUEUED characterId=${c.id} name="${c.name ?? ""}" scenario="${scenario.title}" assetId=${assetId}`);
  }

  console.log(`\nDone. Enqueued=${enqueued} skippedNoImage=${skippedNoImage} skippedAlreadyDone=${skippedAlreadyDone}`);
  console.log("The worker drains jobs serially. Monitor progress via the media worker logs.");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("REMINDER: the BullMQ media worker must be running for jobs to process.");

  if (flagValidateOne) {
    await validateOne();
    return;
  }

  if (flagAll && flagConfirm) {
    await runAll();
    return;
  }

  if (flagAll && !flagConfirm) {
    console.error(
      "ERROR: --all requires --confirm. Enqueuing the full batch is ~30-40h of serial GPU time.\n" +
      "Required incantation: npx tsx backend/scripts/bulk-generate-videos.ts --all --confirm",
    );
    process.exit(1);
  }

  if (flagConfirm && !flagAll) {
    console.error(
      "ERROR: --confirm requires --all. Both flags must be present together.\n" +
      "Required incantation: npx tsx backend/scripts/bulk-generate-videos.ts --all --confirm",
    );
    process.exit(1);
  }

  // Default: dry-run
  await dryRun();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
