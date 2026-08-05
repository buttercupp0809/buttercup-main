// CCBill DataLink Post/BackgroundPost webhook. Signature verification uses
// the DIGEST-based scheme documented in the CCBill Admin portal (MD5 over
// specific concatenated fields + the DataLink salt).

import crypto from "node:crypto";
import type { NormalizedEvent } from "../types";
import { normalizeTier } from "../../subscription/tier";

interface CcBillPayload {
  eventType: string;
  subscriptionId?: string;
  transactionId?: string;
  clientAccnum?: string;
  clientSubacc?: string;
  timestamp?: string;
  digest?: string;
  userId?: string; // we pass buttercupp user id through as customFields[0]
  tier?: string;
  tokenPackId?: string;
  amount?: string;
  currencyCode?: string;
  nextRenewalDate?: string;
}

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
