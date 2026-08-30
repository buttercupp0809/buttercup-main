// Admin CLI: enqueue a LoRA training job for a character.
//
// Usage:
//   npm run lora:train -- <characterId>
//
// Requires a local backend/.env with REDIS_URL set and DATABASE_URL pointed
// at a reachable Postgres instance. LOCAL DEV ONLY; not for production (the
// admin HTTP route at POST /admin/lora/train is the production path).
//
// Steps:
//   1. Resolve the character and its currentVersionId from the database.
//   2. Create a CharacterLora row with status "pending".
//   3. Enqueue a train-lora job on the BullMQ lora queue.

import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });

import { prisma } from "@buttercupp/database";
import { enqueueTrainLoraJob } from "../src/queue/lora-queue";

async function main(): Promise<void> {
  const characterId = process.argv[2];
  if (!characterId) {
    console.error("usage: npm run lora:train -- <characterId>");
    process.exit(1);
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, currentVersionId: true },
  });

  if (!character) {
    console.error(`no character found with id: ${characterId}`);
    process.exit(1);
  }

  if (!character.currentVersionId) {
    console.error(`character ${characterId} (${character.name}) has no currentVersionId`);
    process.exit(1);
  }

  const characterVersionId = character.currentVersionId;

  // Create the pending CharacterLora row.
  const loraRow = await prisma.characterLora.create({
    data: {
      characterId,
      characterVersionId,
      status: "pending",
    },
  });

  console.log(`Created CharacterLora row: ${loraRow.id} (status: pending)`);
  console.log(`  character: ${characterId} (${character.name})`);
  console.log(`  version:   ${characterVersionId}`);

  // Enqueue the training job.
  const { jobId } = await enqueueTrainLoraJob({
    source: "train-lora",
    characterId,
    characterVersionId,
    requestedBy: "admin-cli",
  });

  console.log(`Enqueued train-lora job: ${jobId}`);
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
