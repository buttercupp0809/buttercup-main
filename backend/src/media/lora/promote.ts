// LoRA promoter: records the outcome of LoRA validation into the database.
//
// On pass:
//   - Flips CharacterLora.status to "ready"
//   - Sets s3Key, triggerToken, checkpointStep, arcfaceScore
//   - Mirrors s3Key into the character version's AppearanceSheet.loraRef
//     so the generation read-path (Task 7) picks it up
//
// On fail:
//   - Sets CharacterLora.status to "rejected" and records an error string
//   - Does NOT touch AppearanceSheet
//
// The appearance-sheet mirror requires resolving the version's appearanceSheetId.
// If the version has no sheet (orphaned or not yet created), the mirror is
// skipped gracefully without throwing.
//
// Uses the Prisma singleton; never constructs PrismaClient directly.

import { prisma } from "@buttercupp/database";
import type { ValidateLoraResult } from "./validate";

export interface PromoteLoraArgs {
  loraId: string;
  result: ValidateLoraResult;
  /** S3 key for the best checkpoint selected by the validator. */
  s3Key: string;
  /** Trigger token (e.g. "ch_abc") used when generating images with this LoRA. */
  triggerToken: string;
}

/**
 * Promote or reject a LoRA checkpoint after validation.
 *
 * Pass: status -> "ready", s3Key/triggerToken/checkpointStep/arcfaceScore set,
 *       AppearanceSheet.loraRef mirrored.
 * Fail: status -> "rejected", error set, no AppearanceSheet update.
 */
export async function promoteLora({
  loraId,
  result,
  s3Key,
  triggerToken,
}: PromoteLoraArgs): Promise<void> {
  if (result.pass) {
    // Update CharacterLora to ready, capturing characterVersionId for the mirror.
    // The explicit select types characterVersionId via Prisma so a future
    // schema rename surfaces as a type error here.
    const loraRow = await prisma.characterLora.update({
      where: { id: loraId },
      data: {
        status: "ready",
        s3Key,
        triggerToken,
        checkpointStep: result.bestStep,
        arcfaceScore: result.meanScore,
      },
      select: { id: true, characterVersionId: true },
    });

    // Mirror s3Key into AppearanceSheet.loraRef so the generation read-path
    // picks up the new LoRA without a separate lookup.
    const characterVersionId = loraRow.characterVersionId;

    if (characterVersionId) {
      const version = await prisma.characterVersion.findUnique({
        where: { id: characterVersionId },
        select: { id: true, appearanceSheetId: true },
      });

      if (version?.appearanceSheetId) {
        await prisma.appearanceSheet.update({
          where: { id: version.appearanceSheetId },
          data: { loraRef: s3Key },
        });
      }
      // If version is null or has no sheet, skip gracefully (do not throw).
    }
  } else {
    const errorMsg = `LoRA validation failed: meanScore ${result.meanScore.toFixed(4)} below baseline ${result.baselineScore.toFixed(4)}`;

    await prisma.characterLora.update({
      where: { id: loraId },
      data: {
        status: "rejected",
        error: errorMsg,
      },
    });
  }
}
