import crypto from "node:crypto";
import type { CheckoutRequest, CheckoutResponse } from "./types";

export function isConfigured(): boolean {
  return Boolean(process.env.SEGPAY_PACKAGE_ID && process.env.SEGPAY_URL_ID);
}

export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
  if (!isConfigured()) throw new Error("segpay_not_configured");
  const externalId = `segpay:${crypto.randomUUID()}`;
  const url = `https://secure2.segpay.com/billing/poset.cgi?x-eticket=${process.env.SEGPAY_URL_ID}:${process.env.SEGPAY_PACKAGE_ID}&x-reference-id=${externalId}&x-success=${encodeURIComponent(req.successUrl)}`;
  return {
    provider: "segpay",
    checkoutUrl: url,
    externalId,
  };
}

export async function cancelAtPeriodEnd(externalSubscriptionId: string): Promise<void> {
  if (!isConfigured()) throw new Error("segpay_not_configured");
  void externalSubscriptionId;
}
