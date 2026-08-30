// LoRA training job orchestrator.
//
// Advances a CharacterLora row through the training pipeline:
//   pending -> building -> training -> validating -> ready | rejected
//
// On any thrown stage, flips status to "failed" and records the error message.
//
// All five stages are injected through HandlerDeps so the handler is fully
// unit-testable without a live GPU box, S3, or database. Production wiring
// uses the real stage functions as defaults; fakes are injected in tests.
//
// NOTE: box + S3 clients required by the real buildDataset / runTraining /
// validateLora sub-deps are NOT wired here. Those surfaces are left as clear
// seams in PRODUCTION_HANDLER_DEPS for the infra layer to fill in when the
// box clients exist. See DEFERRED_WIRING note below.

import { prisma } from "@buttercupp/database";
import type { TrainLoraJobPayload, LoraStatus } from "@buttercupp/shared";
import { makeTriggerToken } from "./caption";
import type { BuildDatasetResult } from "./dataset";
import type { TrainingResult } from "./train";
import type { ValidateLoraResult } from "./validate";
import type { PromoteLoraArgs } from "./promote";

// ---------------------------------------------------------------------------
// Dependency injection interface
//
// Each method is a fully-self-contained callable: its sub-deps (box/S3
// clients) are baked into the closure so the orchestrator never needs to
// know about them. In production the real stage fns are wrapped with
// DEFERRED placeholder sub-deps; in tests vi.fn() mocks replace the whole
// callable.
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  /** Stage 1: build the curated training dataset. */
  buildDataset(args: {
    characterId: string;
    characterVersionId: string;
    targetCount: number;
  }): Promise<BuildDatasetResult>;

  /** Stage 2a: caption a single image (called per dataset image). */
  captionImage(args: { imageKey: string; triggerToken: string }): Promise<string>;

  /** Stage 2b: submit + collect a kohya training run. */
  runTraining(args: {
    datasetDir: string;
    outputName: string;
    rank: number;
  }): Promise<TrainingResult>;

  /** Stage 3: validate checkpoints via ArcFace scoring. */
  validateLora(args: {
    referenceKey: string;
    checkpoints: Array<{ step: number; key: string }>;
    promptSet: string[];
  }): Promise<ValidateLoraResult>;

  /** Stage 4: promote (set ready/rejected) in the DB. */
  promoteLora(args: PromoteLoraArgs): Promise<void>;
}

// ---------------------------------------------------------------------------
// Production defaults
//
// DEFERRED_WIRING: DatasetDeps, TrainingDeps, and ValidateDeps require sub-deps
// (listGallery, score, genTurntable, uploadManifest, submitJob,
// collectCheckpoints, baseline, scoreChain) that need box + S3 clients not yet
// provisioned. Each wrapper below satisfies TypeScript but will throw at
// runtime. Replace with real clients once the infra layer provides them.
// ---------------------------------------------------------------------------

import { buildDataset as _buildDataset } from "./dataset";
import { captionImage as _captionImage } from "./caption";
import { runTraining as _runTraining } from "./train";
import { validateLora as _validateLora } from "./validate";
import { promoteLora as _promoteLora } from "./promote";

const PRODUCTION_HANDLER_DEPS: HandlerDeps = {
  buildDataset: (args) =>
    _buildDataset(args, {
      // DEFERRED: replace with real S3 + box clients.
      listGallery: () => Promise.reject(new Error("listGallery: box client not wired")),
      score: () => Promise.reject(new Error("score: arcface client not wired")),
      genTurntable: () => Promise.reject(new Error("genTurntable: box client not wired")),
      uploadManifest: () => Promise.reject(new Error("uploadManifest: S3 client not wired")),
    }),

  captionImage: (args) =>
    _captionImage(args, {
      // DEFERRED: replace with real VLM client.
      vlmCaption: () => Promise.reject(new Error("vlmCaption: VLM client not wired")),
    }),

  runTraining: (args) =>
    _runTraining(args, {
      // DEFERRED: replace with real box HTTP client.
      submitJob: () => Promise.reject(new Error("submitJob: box client not wired")),
      collectCheckpoints: () =>
        Promise.reject(new Error("collectCheckpoints: box client not wired")),
    }),

  validateLora: (args) =>
    _validateLora(args, {
      // DEFERRED: replace with real ArcFace + box clients.
      baseline: () => Promise.reject(new Error("baseline: arcface client not wired")),
      scoreChain: () =>
        Promise.reject(new Error("scoreChain: arcface+box client not wired")),
    }),

  promoteLora: (args) => _promoteLora(args),
};

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------

async function setStatus(
  loraId: string,
  status: LoraStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.characterLora.update({
    where: { id: loraId },
    data: { status, ...extra },
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a full LoRA training pipeline for a character.
 *
 * Flow:
 *   1. Finds or creates the CharacterLora row for this job.
 *   2. Advances status: building -> training -> validating.
 *   3. Calls promoteLora which sets final status (ready or rejected).
 *   4. On any thrown stage, sets status "failed" + records the error.
 *      Never rethrows; BullMQ retry logic is owned by the worker wrapper.
 *
 * @param payload - Validated job payload (trainLoraJobPayloadSchema).
 * @param deps    - Injected stage deps. Defaults to PRODUCTION_HANDLER_DEPS.
 */
export async function runTrainLoraJob(
  payload: TrainLoraJobPayload,
  deps: HandlerDeps = PRODUCTION_HANDLER_DEPS,
): Promise<void> {
  const { characterId, characterVersionId, targetImageCount, baseModel } = payload;

  // ------------------------------------------------------------------
  // 1. Resolve the CharacterLora row. Task 14 (admin route) creates a
  //    "pending" row before enqueuing and passes loraId via the payload.
  //    As a safety net, we also handle the case where the row does not
  //    yet exist (create it here).
  //
  //    This resolution is intentionally OUTSIDE the try/catch below: if we
  //    have no row, there is nowhere to record a "failed" status, so a throw
  //    here should surface to BullMQ (whose own `failed` event covers it)
  //    rather than be swallowed into a status write that has no target.
  // ------------------------------------------------------------------
  let loraRow = await prisma.characterLora.findFirst({
    where: { characterId, characterVersionId },
    orderBy: { createdAt: "desc" },
  });

  if (!loraRow) {
    loraRow = await prisma.characterLora.create({
      data: {
        characterId,
        characterVersionId,
        status: "pending",
        baseModel,
      },
    });
  }

  const loraId = loraRow.id;
  const triggerToken = makeTriggerToken(characterId);

  // ------------------------------------------------------------------
  // 2. Pipeline: each stage updates status before running.
  // ------------------------------------------------------------------
  try {
    // Stage 1: Build dataset
    await setStatus(loraId, "building");
    const datasetResult = await deps.buildDataset({
      characterId,
      characterVersionId,
      targetCount: targetImageCount,
    });

    // Stage 2: Caption images + run training
    await setStatus(loraId, "training");

    // Caption each dataset image. captionImage is best-effort; if the VLM
    // client is not yet wired, the error surfaces here and the job fails.
    for (const img of datasetResult.images) {
      await deps.captionImage({ imageKey: img.key, triggerToken });
    }

    const trainingResult = await deps.runTraining({
      datasetDir: datasetResult.manifestKey,
      outputName: triggerToken,
      rank: 32,
    });

    // Stage 3: Validate checkpoints
    await setStatus(loraId, "validating");
    const referenceKey = `ref/${characterId}/${characterVersionId}`;
    const promptSet = [
      `${triggerToken} a portrait photo`,
      `${triggerToken} a full body photo`,
    ];
    const validationResult = await deps.validateLora({
      referenceKey,
      checkpoints: trainingResult.checkpoints,
      promptSet,
    });

    // Stage 4: Promote (sets ready or rejected via promoteLora)
    await deps.promoteLora({
      loraId,
      result: validationResult,
      s3Key: validationResult.bestKey,
      triggerToken,
    });
  } catch (err) {
    // Any thrown stage: record failure, never rethrow so the BullMQ worker
    // can decide its own retry policy.
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.characterLora
      .update({
        where: { id: loraId },
        data: { status: "failed", error: errorMsg },
      })
      .catch(() => null); // best-effort: do not mask the original error path
  }
}
