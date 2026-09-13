// Reusable entry point to kick off a per-character LoRA training run.
//
// Shared by the admin route (POST /admin/lora/train) and the on-publish
// auto-train trigger so both go through the SAME duplicate guard: a character
// that already has an active run (pending/building/training/validating) or a
// ready LoRA for the current version is NOT retrained. Each run is a real,
// long GPU job, so re-publishing or double-submitting must be idempotent.
//
// The DB (prisma singleton) is used directly; enqueue is injectable so callers
// and tests can substitute a fake without Redis. Never throws on enqueue
// failure: the pending row is still created and the error is returned so the
// caller can decide how to surface it (non-blocking, mirrors the media routes).

import { prisma } from "@buttercupp/database";
import type { LoraStatus, TrainLoraJobPayload } from "@buttercupp/shared";
import { enqueueTrainLoraJob } from "../../queue/lora-queue";

type BaseModel = TrainLoraJobPayload["baseModel"];

// Statuses that mean a run is already covering this character version, so a new
// enqueue would be wasteful. "ready" is handled separately (already trained).
const ACTIVE_STATUSES: readonly LoraStatus[] = ["pending", "building", "training", "validating"];

export interface StartCharacterLoraTrainingArgs {
  characterId: string;
  /** Omit to resolve the character's currentVersionId. */
  characterVersionId?: string;
  requestedBy: string;
  targetImageCount?: number;
  baseModel?: BaseModel;
}

export interface StartCharacterLoraTrainingResult {
  loraId: string | null;
  status: LoraStatus | "none";
  jobId?: string;
  skipped?: "already_active" | "already_ready" | "no_current_version" | "character_not_found";
  enqueueError?: string;
}

export interface StartTrainingDeps {
  enqueue?: typeof enqueueTrainLoraJob;
}

export async function startCharacterLoraTraining(
  args: StartCharacterLoraTrainingArgs,
  deps: StartTrainingDeps = {},
): Promise<StartCharacterLoraTrainingResult> {
  const enqueue = deps.enqueue ?? enqueueTrainLoraJob;

  // Resolve the version: use the provided one, else the character's current.
  let characterVersionId = args.characterVersionId;
  if (!characterVersionId) {
    const character = await prisma.character.findUnique({
      where: { id: args.characterId },
      select: { currentVersionId: true },
    });
    if (!character) return { loraId: null, status: "none", skipped: "character_not_found" };
    if (!character.currentVersionId) return { loraId: null, status: "none", skipped: "no_current_version" };
    characterVersionId = character.currentVersionId;
  }

  // Duplicate guard: skip when an active run or a ready LoRA already exists for
  // this exact (character, version).
  const existing = await prisma.characterLora.findFirst({
    where: { characterId: args.characterId, characterVersionId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (existing) {
    const status = existing.status as LoraStatus;
    if (ACTIVE_STATUSES.includes(status)) {
      return { loraId: existing.id, status, skipped: "already_active" };
    }
    if (status === "ready") {
      return { loraId: existing.id, status: "ready", skipped: "already_ready" };
    }
    // failed / rejected fall through: a fresh run is allowed.
  }

  const row = (await prisma.characterLora.create({
    data: {
      characterId: args.characterId,
      characterVersionId,
      status: "pending",
      ...(args.baseModel ? { baseModel: args.baseModel } : {}),
    },
  })) as { id: string };

  let jobId: string | undefined;
  let enqueueError: string | undefined;
  try {
    const result = await enqueue({
      source: "train-lora",
      characterId: args.characterId,
      characterVersionId,
      requestedBy: args.requestedBy,
      targetImageCount: args.targetImageCount ?? 30,
      baseModel: args.baseModel ?? "realvisxl_v5",
    });
    jobId = result.jobId;
  } catch (err) {
    enqueueError = err instanceof Error ? err.message : String(err);
  }

  return {
    loraId: row.id,
    status: "pending",
    ...(jobId ? { jobId } : {}),
    ...(enqueueError ? { enqueueError } : {}),
  };
}
