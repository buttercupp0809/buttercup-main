// SegPay webhook. Signature is HMAC-SHA1 over the raw body with the
// SEGPAY_HMAC_KEY (SegPay's Postback Notification docs).

import crypto from "node:crypto";
import type { NormalizedEvent } from "../types";
import { normalizeTier } from "../../subscription/tier";

export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  const key = process.env.SEGPAY_HMAC_KEY;
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha1", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const TYPE_MAP: Record<string, NormalizedEvent["eventType"]> = {
  auth: "subscription.activated",
  rebill: "transaction.completed",
  cancel: "subscription.canceled",
  expiration: "subscription.canceled",
  chargeback: "payment_failed",
  refund: "payment_failed",
};

interface SegPayPayload {
  eventType?: string;
  transactionID?: string;
  reference?: string;
  userId?: string;
  tier?: string;
  tokenPackId?: string;
  amount?: string;
  currency?: string;
  nextRebillDate?: string;
}

export function normalize(payload: SegPayPayload): NormalizedEvent | null {
  const eventType = payload.eventType ? TYPE_MAP[payload.eventType] : undefined;
  if (!eventType || !payload.userId) return null;
  return {
    provider: "segpay",
    eventId: payload.transactionID ?? payload.reference ?? `${payload.eventType}:${Date.now()}`,
    eventType,
    userId: payload.userId,
    tier: payload.tier ? normalizeTier(payload.tier) : undefined,
    tokenPackId: payload.tokenPackId,
    amount: payload.amount ? Math.round(Number(payload.amount) * 100) : undefined,
    currency: payload.currency,
    currentPeriodEnd: payload.nextRebillDate,
    externalSubscriptionId: payload.reference,
    raw: payload as unknown as Record<string, unknown>,
  };
}
