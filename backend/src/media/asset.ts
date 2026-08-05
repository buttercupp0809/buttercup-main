// MediaAsset lifecycle. All transitions go through here so the state
// machine (queued -> processing -> ready | failed) has exactly one
// implementation. Illegal transitions throw; the worker relies on that to
// bail out early on a re-delivery.

import { prisma } from "@buttercupp/database";
import type { MediaAsset, MediaKind, MediaStatus, Prisma } from "@buttercupp/database";

const ALLOWED: Record<MediaStatus, MediaStatus[]> = {
  queued: ["processing", "failed"],
  processing: ["ready", "failed"],
  ready: [],
  failed: [],
};

function assertTransition(from: MediaStatus, to: MediaStatus): void {
  const ok = ALLOWED[from]?.includes(to) ?? false;
  if (!ok) throw new Error(`invalid_transition: ${from} -> ${to}`);
}

export interface CreateAssetParams {
  userId: string;
  characterId: string | null;
  kind: MediaKind;
  meta?: Record<string, unknown>;
}

export async function createQueuedAsset(params: CreateAssetParams): Promise<MediaAsset> {
  return prisma.mediaAsset.create({
    data: {
      userId: params.userId,
      characterId: params.characterId ?? undefined,
      kind: params.kind,
      status: "queued",
      meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

async function transition(id: string, next: MediaStatus, patch: Prisma.MediaAssetUpdateInput): Promise<MediaAsset> {
  const current = await prisma.mediaAsset.findUnique({ where: { id }, select: { status: true } });
  if (!current) throw new Error("asset_not_found");
  assertTransition(current.status, next);
  return prisma.mediaAsset.update({
    where: { id },
    data: { ...patch, status: next },
  });
}

export function markProcessing(id: string, jobId: string): Promise<MediaAsset> {
  return transition(id, "processing", { jobId });
}

export function markReady(
  id: string,
  s3Key: string,
  meta: Record<string, unknown>,
): Promise<MediaAsset> {
  return transition(id, "ready", { s3Key, meta: meta as Prisma.InputJsonValue });
}

export function markFailed(id: string, error: string): Promise<MediaAsset> {
  return transition(id, "failed", {
    meta: { error } as Prisma.InputJsonValue,
  });
}

// Test-only helpers.
export const _internal = { assertTransition, ALLOWED };
