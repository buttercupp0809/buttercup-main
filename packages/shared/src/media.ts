// Media pipeline DTOs. Shared between the enqueue API, the queue producer,
// the worker, and the SSE/WS client so a single source of truth defines the
// wire shapes.

import { z } from "zod";

export const MEDIA_QUEUE_NAME = "poppy-media";

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
