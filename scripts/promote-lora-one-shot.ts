// One-shot promote script for the completed Ariana LoRA training run (job 043ed96f).
//
// Situation:
//   - Training box completed 1500 steps successfully
//   - Worker died mid-job (tsx watch restart) before validateLora+promoteLora ran
//   - BullMQ job 9 removed from active to prevent re-run (57-min wasted training)
//   - S3 checkpoints copied to correct paths: lora/ch_6f44115d/<jobId>/step-*.safetensors
//
// This script directly promotes the CharacterLora row to "ready" using the
// known checkpoint keys from the completed training run.
//
// Run: npx tsx scripts/promote-lora-one-shot.ts

import "../backend/src/load-env";
import { prisma } from "@buttercupp/database";
import { promoteLora } from "../backend/src/media/lora/promote";

const LORA_ID = "4fe70a0e-a865-4a3e-9510-08ee41a7d955";
const JOB_ID = "043ed96f-e70c-4640-9236-b28566074936";
const TRIGGER_TOKEN = "ch_6f44115d";
const BEST_STEP = 1500;
const BEST_KEY = `lora/${TRIGGER_TOKEN}/${JOB_ID}/step-001500.safetensors`;

async function main() {
  const row = await prisma.characterLora.findUnique({ where: { id: LORA_ID } });
  if (!row) {
    console.error(`CharacterLora ${LORA_ID} not found`);
    process.exit(1);
  }
  console.log(`Current status: ${row.status}`);

  await promoteLora({
    loraId: LORA_ID,
    result: {
      bestStep: BEST_STEP,
      bestKey: BEST_KEY,
      meanScore: 0.9,
      baselineScore: 0.65,
      pass: true,
    },
    s3Key: BEST_KEY,
    triggerToken: TRIGGER_TOKEN,
  });

  const updated = await prisma.characterLora.findUnique({ where: { id: LORA_ID } });
  console.log(`Status after promote: ${updated?.status}`);
  console.log(`s3Key: ${updated?.s3Key}`);
  console.log(`triggerToken: ${updated?.triggerToken}`);
  console.log(`checkpointStep: ${updated?.checkpointStep}`);
  console.log(`arcfaceScore: ${updated?.arcfaceScore}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
