// Media handler registry. Phase 08 (voice) and Phase 09 (image) plug real
// providers into this map without touching queue/worker/token/S3 code. For
// Phase 07 every kind is served by mockHandler so the pipeline is testable
// end-to-end.

import type { MediaJobData, MediaKind } from "@buttercupp/shared";

export interface HandlerOutput {
  buffer: Buffer;
  contentType: string;
  meta: Record<string, unknown>;
}

export type MediaHandler = (job: MediaJobData) => Promise<HandlerOutput>;

// A 1x1 transparent PNG (67 bytes) + a short WAV silence. Small enough to
// keep tests fast, real enough that the storage path exercises binary I/O.
const TINY_PNG = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000000000200015E0A62F00000000049454E44AE426082",
  "hex",
);
const TINY_WAV = Buffer.from(
  "52494646240000005741564566" +
    "6D74201000000001000100401F0000401F0000010008006461746100000000",
  "hex",
);
const TINY_MP4 = TINY_PNG; // placeholder for the reserved video kind

// Exported so tests (and a manual queue smoke-test) can register a
// deterministic no-network handler via registerHandler().
export async function mockHandler(job: MediaJobData): Promise<HandlerOutput> {
  switch (job.kind) {
    case "image":
      return { buffer: TINY_PNG, contentType: "image/png", meta: { mock: true } };
    case "voice":
      return { buffer: TINY_WAV, contentType: "audio/wav", meta: { mock: true } };
    case "video":
      return { buffer: TINY_MP4, contentType: "video/mp4", meta: { mock: true } };
  }
}

import { voiceHandler } from "./voice";
import { imageHandler } from "./image";
import { videoHandler } from "./video";

export const handlers: Record<MediaKind, MediaHandler> = {
  image: imageHandler,
  voice: voiceHandler,
  video: videoHandler,
};

// Phase 08 / 09 call this at boot to swap the mock for a real provider.
export function registerHandler(kind: MediaKind, handler: MediaHandler): void {
  handlers[kind] = handler;
}
