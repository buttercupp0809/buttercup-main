// CCBill DataLink Post/BackgroundPost webhook. Signature verification uses
// the DIGEST-based scheme documented in the CCBill Admin portal (MD5 over
// specific concatenated fields + the DataLink salt).

import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedEvent } from "../types";
import { normalizeTier } from "../../subscription/tier";

// Shape validated at the trust boundary BEFORE verifySignature/normalize
// ever see the body (backend/src/http/billing.ts). All fields are optional
// strings because CCBill's DataLink postback is form-encoded and only
// `eventType` is guaranteed present; verifySignature/normalize already
// null-check the fields they require.
export const ccbillWebhookSchema = z.object({
  eventType: z.string(),
  subscriptionId: z.string().optional(),
  transactionId: z.string().optional(),
  clientAccnum: z.string().optional(),
  clientSubacc: z.string().optional(),
  timestamp: z.string().optional(),
  digest: z.string().optional(),
  userId: z.string().optional(),
  tier: z.string().optional(),
  tokenPackId: z.string().optional(),
  amount: z.string().optional(),
  currencyCode: z.string().optional(),
  nextRenewalDate: z.string().optional(),
});
export type CcBillPayload = z.infer<typeof ccbillWebhookSchema>;

export function verifySignature(payload: CcBillPayload): boolean {
  const salt = process.env.CCBILL_DATALINK_SALT;
  if (!salt) return false;
  if (!payload.digest || !payload.subscriptionId || !payload.timestamp) return false;
  const expected = crypto
    .createHash("md5")
    .update(`${payload.subscriptionId}${payload.timestamp}${salt}`)
    .digest("hex");
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(payload.digest);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const TYPE_MAP: Record<string, NormalizedEvent["eventType"]> = {
  NewSaleSuccess: "subscription.activated",
  RenewalSuccess: "transaction.completed",
  Cancellation: "subscription.canceled",
  Expiration: "subscription.canceled",
  Chargeback: "payment_failed",
  Refund: "payment_failed",
};

export function normalize(payload: CcBillPayload): NormalizedEvent | null {
  const eventType = TYPE_MAP[payload.eventType];
  if (!eventType || !payload.userId) return null;
  const externalSubscriptionId = payload.subscriptionId;
  const eventId = payload.transactionId ?? `${externalSubscriptionId}:${payload.eventType}:${payload.timestamp}`;
  return {
    provider: "ccbill",
    eventId,
    eventType,
    userId: payload.userId,
    tier: payload.tier ? normalizeTier(payload.tier) : undefined,
    tokenPackId: payload.tokenPackId,
    amount: payload.amount ? Math.round(Number(payload.amount) * 100) : undefined,
    currency: payload.currencyCode ?? "USD",
    currentPeriodEnd: payload.nextRenewalDate,
    externalSubscriptionId,
    raw: payload as unknown as Record<string, unknown>,
  };
}
