// WebSocket fan-out bridge. The worker runs in its own process (or ECS task)
// and must not import the WS gateway directly; instead it publishes on a
// per-user Redis pub/sub channel and any gateway node with a live
// connection for that user forwards the payload.

import type { MediaReadyEventPayload } from "@poppy/shared";
import { getRedisConnection } from "./connection";

export type WsBridgeMessage =
  | { type: "media.ready"; payload: MediaReadyEventPayload }
  | { type: "media.error"; payload: { mediaAssetId: string; message: string } };

export function userChannel(userId: string): string {
  return `poppy:ws:${userId}`;
}

// Fire-and-forget publish. Callers do not await network I/O to keep the
// worker's job loop tight.
export async function publishToUser(userId: string, msg: WsBridgeMessage): Promise<void> {
  const r = getRedisConnection();
  if (!r) return;
  try {
    await r.publish(userChannel(userId), JSON.stringify(msg));
  } catch {
    // pub/sub failure is logged upstream; do not throw
  }
}

export function notifyMediaReady(userId: string, payload: MediaReadyEventPayload): Promise<void> {
  return publishToUser(userId, { type: "media.ready", payload });
}

export function notifyMediaError(userId: string, mediaAssetId: string, message: string): Promise<void> {
  return publishToUser(userId, { type: "media.error", payload: { mediaAssetId, message } });
}
