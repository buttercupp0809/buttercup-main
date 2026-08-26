// MediaAsset lifecycle. All transitions go through here so the state
// machine (queued -> processing -> ready | failed) has exactly one
// implementation. Illegal transitions throw; the worker relies on that to
// bail out early on a re-delivery.

import { prisma, backfillCharacterDisplay } from "@buttercupp/database";
import type { MediaAsset, MediaKind, MediaStatus, Prisma } from "@buttercupp/database";

const ALLOWED: Record<MediaStatus, MediaStatus[]> = {
  // "processing -> processing" is allowed so a BullMQ RETRY (or a re-delivery)
  // can re-enter processing and re-run the render. Without it, any job whose
  // first attempt failed after markProcessing was permanently poisoned: every
  // retry threw invalid_transition at the status guard before reaching the
  // render, so the job could never succeed.
  queued: ["processing", "failed"],
  processing: ["processing", "ready", "failed"],
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

export interface CreateReadyAssetParams {
  userId: string;
  characterId: string | null;
  kind: MediaKind;
  s3Key: string;
  meta?: Record<string, unknown>;
}

// Creates an asset directly in the "ready" state, bypassing the queued state
// machine. Use this for synchronous generation that does not go through the
// BullMQ worker queue.
export async function createReadyAsset(params: CreateReadyAssetParams): Promise<MediaAsset> {
  return prisma.mediaAsset.create({
    data: {
      userId: params.userId,
      characterId: params.characterId ?? undefined,
      kind: params.kind,
      s3Key: params.s3Key,
      status: "ready",
      meta: (params.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
}

// ============================================================================
// Phase 28: creation-time dual write. Mirrors the MediaAsset + CharacterMedia
// pattern already used by backend/src/chat/image-turn.ts for chat selfies,
// so cards/chat/gallery all read a consistent CharacterMedia store no
// matter which path produced the image.
// ============================================================================

export interface AttachCreationMediaParams {
  characterId: string;
  // Raw storable S3 key, the same value shape MediaAsset.s3Key holds and the
  // same shape chat/image-turn.ts writes into CharacterMedia.url (NOT a
  // pre-signed expiring URL; signing happens at read time).
  url: string;
  sort: number;
}

// Phase 26 added CharacterMedia.isDisplay as the free/public asset flag,
// decoupled from isPrimary (now hero/paywalled, a separate concern this
// phase does not set). We insert the new row with isDisplay: false and then
// call the Phase-26 backfillCharacterDisplay helper, which atomically
// recomputes (inside its own transaction: clear-all then set-one) the
// single correct display asset from every image row's isPrimary/sort/
// createdAt. That recompute is idempotent and safe to call after every new
// creation image, so two concurrent creation jobs for the same character
// can never leave two (or zero) rows flagged isDisplay: true; whichever
// recompute commits last always converges on exactly one winner.
export async function attachCreationCharacterMedia(
  params: AttachCreationMediaParams,
): Promise<{ characterMediaId: string }> {
  const media = await prisma.characterMedia.create({
    data: {
      characterId: params.characterId,
      kind: "image",
      url: params.url,
      isPrimary: false,
      isDisplay: false,
      sort: params.sort,
    },
    select: { id: true },
  });
  await backfillCharacterDisplay(params.characterId);
  return { characterMediaId: media.id };
}

export interface AttachVideoCharacterMediaParams {
  characterId: string;
  // Raw storable S3 key (not a pre-signed expiring URL; signing happens at
  // read time), matching the shape MediaAsset.s3Key and CharacterMedia.url hold.
  url: string;
  title?: string;
}

// Phase 28 video dual-write. Mirrors attachCreationCharacterMedia but for
// video kind. No sort (defaults to 0 via DB) and no backfillCharacterDisplay
// call (that helper is image-display logic only).
export async function attachVideoCharacterMedia(
  params: AttachVideoCharacterMediaParams,
): Promise<{ characterMediaId: string }> {
  const media = await prisma.characterMedia.create({
    data: {
      characterId: params.characterId,
      kind: "video",
      url: params.url,
      isPrimary: false,
      isDisplay: false,
      ...(params.title !== undefined ? { title: params.title } : {}),
    },
    select: { id: true },
  });
  return { characterMediaId: media.id };
}

// Observability-only: records which CharacterMedia row a ready MediaAsset
// produced. Not a status transition (the asset is already `ready`), so it
// goes through a plain update rather than the transition() state machine.
export async function attachCharacterMediaMeta(
  mediaAssetId: string,
  characterMediaId: string,
): Promise<void> {
  const current = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: { meta: true },
  });
  const meta = (current?.meta as Record<string, unknown> | null) ?? {};
  await prisma.mediaAsset.update({
    where: { id: mediaAssetId },
    data: { meta: { ...meta, characterMediaId } as Prisma.InputJsonValue },
  });
}

// Test-only helpers.
export const _internal = { assertTransition, ALLOWED };
