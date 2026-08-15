// Coinbase Commerce webhook. Crypto is offered for ONE-TIME TOKEN PACKS
// only (see ./crypto.ts adapter comment and Phase 27 processor
// recommendation): hosted crypto checkout does not rebill, so this handler
// must never map an event to subscription.activated.
//
// Signature: Coinbase Commerce signs the raw request body with HMAC-SHA256
// using the webhook shared secret, sent in the `X-CC-Webhook-Signature`
// header as a hex digest (Coinbase Commerce webhook docs).

import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedEvent } from "../types";

export const cryptoWebhookSchema = z.object({
  event: z.object({
    id: z.string().optional(),
    type: z.string(),
    data: z.object({
      id: z.string().optional(),
      code: z.string().optional(),
      metadata: z
        .object({
          userId: z.string().optional(),
          tokenPackId: z.string().optional(),
        })
        .optional(),
    }),
  }),
});
export type CryptoWebhookPayload = z.infer<typeof cryptoWebhookSchema>;

export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Coinbase Commerce charge lifecycle events. Only "confirmed" (on-chain
// payment seen) and "resolved" (a delayed/underpaid charge later settled)
// count as completed; "pending"/"failed"/"delayed"/"expired" are ignored by
// returning null (unmapped) rather than forcing a mapping that does not fit
// NormalizedEventType.
const TYPE_MAP: Record<string, NormalizedEvent["eventType"]> = {
  "charge:confirmed": "transaction.completed",
  "charge:resolved": "transaction.completed",
};

export function normalize(payload: CryptoWebhookPayload): NormalizedEvent | null {
  const eventType = TYPE_MAP[payload.event.type];
  const metadata = payload.event.data.metadata;
  if (!eventType || !metadata?.userId || !metadata.tokenPackId) return null;
  const eventId = payload.event.id ?? `crypto:${payload.event.data.id ?? payload.event.type}:${Date.now()}`;
  return {
    provider: "crypto",
    eventId,
    eventType,
    userId: metadata.userId,
    tokenPackId: metadata.tokenPackId,
    raw: payload as unknown as Record<string, unknown>,
  };
}
