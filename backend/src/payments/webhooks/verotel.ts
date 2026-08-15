// Verotel FlexPay webhook. Signature is SHA-256 over sorted key=value
// params + signatureKey (Verotel docs).

import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedEvent } from "../types";
import { normalizeTier } from "../../subscription/tier";

// Verotel FlexPay postback params are all strings (query-string style).
// `catchall` still requires every extra key to be a string so the signature
// canonicalization (which signs every non-"signature" field) never operates
// on a non-string value.
export const verotelWebhookSchema = z
  .object({
    type: z.string().optional(),
    userId: z.string().optional(),
    tier: z.string().optional(),
    tokenPackId: z.string().optional(),
    priceAmount: z.string().optional(),
    priceCurrency: z.string().optional(),
    nextChargeOn: z.string().optional(),
    referenceID: z.string().optional(),
    transactionID: z.string().optional(),
    saleID: z.string().optional(),
    signature: z.string().optional(),
  })
  .catchall(z.string());
export type VerotelWebhookPayload = z.infer<typeof verotelWebhookSchema>;

export function verifySignature(payload: Record<string, string>): boolean {
  const key = process.env.VEROTEL_SIGNATURE_KEY;
  if (!key || !payload.signature) return false;
  const entries = Object.entries(payload).filter(([k]) => k !== "signature");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const canonical = entries.map(([k, v]) => `${k}=${v}`).join(":");
  const expected = crypto
    .createHash("sha256")
    .update(`${key}:${canonical}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(payload.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const TYPE_MAP: Record<string, NormalizedEvent["eventType"]> = {
  approved: "subscription.activated",
  rebill: "transaction.completed",
  cancel: "subscription.canceled",
  expiry: "subscription.canceled",
  chargeback: "payment_failed",
  refund: "payment_failed",
};

export function normalize(payload: Record<string, string>): NormalizedEvent | null {
  const eventType = TYPE_MAP[payload.type];
  if (!eventType || !payload.userId) return null;
  return {
    provider: "verotel",
    eventId: payload.referenceID ?? payload.transactionID ?? `${payload.type}:${payload.saleID}`,
    eventType,
    userId: payload.userId,
    tier: payload.tier ? normalizeTier(payload.tier) : undefined,
    tokenPackId: payload.tokenPackId,
    amount: payload.priceAmount ? Math.round(Number(payload.priceAmount) * 100) : undefined,
    currency: payload.priceCurrency,
    currentPeriodEnd: payload.nextChargeOn,
    externalSubscriptionId: payload.saleID,
    raw: payload,
  };
}
