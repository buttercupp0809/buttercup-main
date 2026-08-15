// Media pipeline DTOs. Shared between the enqueue API, the queue producer,
// the worker, and the SSE/WS client so a single source of truth defines the
// wire shapes.

import { z } from "zod";

export const MEDIA_QUEUE_NAME = "buttercupp-media";

export const mediaKindSchema = z.enum(["image", "voice", "video"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

// Token cost per media kind. Kept in shared so both the enqueue path and the
// UI can display the price up front. Phases 08/09 may refine per-model
// pricing (e.g. HD image > SD image).
export const MEDIA_TOKEN_COSTS: Record<MediaKind, number> = {
  image: 20,
  voice: 5,
  video: 60, // reserved for Phase-2
};

// Payload is intentionally opaque; per-kind handlers own its shape.
// Handlers must Zod-validate the payload themselves.
export const mediaJobDataSchema = z.object({
  mediaAssetId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  conversationId: z.string().min(1).max(64).nullable(),
  characterId: z.string().min(1).max(64).nullable(),
  kind: mediaKindSchema,
  tokenCost: z.number().int().min(0).max(10000),
  payload: z.record(z.unknown()),
});
export type MediaJobData = z.infer<typeof mediaJobDataSchema>;

export const enqueueMediaRequestSchema = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  characterId: z.string().min(1).max(64).optional(),
  payload: z.record(z.unknown()).default({}),
});
export type EnqueueMediaRequest = z.infer<typeof enqueueMediaRequestSchema>;

export interface EnqueueMediaResponse {
  jobId: string;
  mediaAssetId: string;
  status: "queued";
}

export interface PaywallResponse {
  error: "insufficient_tokens";
  required: number;
  balance: number;
  buyTokensUrl: string;
}

export interface MediaReadyEventPayload {
  mediaAssetId: string;
  url: string;
  kind: MediaKind;
  conversationId: string | null;
}

// ============================================================================
// Phase 28: creation-time image jobs. A brand-new (or freshly edited)
// character enqueues CREATION_IMAGE_COUNT image jobs through the SAME
// MediaJobData/enqueueMediaJob path chat selfies use; `payload` is opaque to
// the queue itself, so this schema just documents/validates the shape that
// the "creation" source puts in that slot. tokenCost is always 0 for these
// jobs (see backend/src/media/token-ledger.ts short-circuit at delta === 0).
// ============================================================================
export const CREATION_IMAGE_COUNT = 4;

export const creationImageJobPayloadSchema = z.object({
  source: z.literal("creation"),
  characterId: z.string().min(1).max(64),
  characterVersionId: z.string().min(1).max(64),
  variant: z.number().int().min(0),
  userRequest: z.string().max(500).optional(),
});
export type CreationImageJobPayload = z.infer<typeof creationImageJobPayloadSchema>;

// Narrows an opaque MediaJobData.payload down to the creation-image shape.
// Returns null for any other job's payload (chat selfies, voice, video),
// so callers can branch on "is this a creation-time image job" without a
// separate boolean flag threaded through MediaJobData itself.
export function parseCreationImagePayload(
  payload: Record<string, unknown>,
): CreationImageJobPayload | null {
  const parsed = creationImageJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

// Polled by the wizard finish screen (and available to any owner-only
// status UI) while creation images are in flight. `primaryReady` reflects
// the character's free-display asset (CharacterMedia.isDisplay when that
// column exists, see Phase 26; the field is still named `primaryReady` on
// the wire because that is what the finish-screen UI was specified against).
export interface GenerationStatusResponse {
  queued: number;
  processing: number;
  ready: number;
  failed: number;
  primaryReady: boolean;
}
