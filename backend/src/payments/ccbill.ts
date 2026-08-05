// CCBill adapter. Real integration needs KYC-approved account, dynamic
// pricing IDs, and the FlexForms hosted checkout URL. This stub captures
// the shape without the network call so the failover chain is testable.

import type { CheckoutRequest, CheckoutResponse } from "./types";

export function isConfigured(): boolean {
  return Boolean(process.env.CCBILL_ACCOUNT_NUMBER && process.env.CCBILL_FLEXFORM_ID);
}

export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
  if (!isConfigured()) throw new Error("ccbill_not_configured");
  const params = new URLSearchParams({
    clientAccnum: process.env.CCBILL_ACCOUNT_NUMBER!,
    formName: process.env.CCBILL_FLEXFORM_ID!,
    currencyCode: "840",
    userId: req.userId,
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
  });
  return {
    provider: "ccbill",
    checkoutUrl: `https://api.ccbill.com/wap-frontflex/flexforms/${process.env.CCBILL_FLEXFORM_ID}?${params.toString()}`,
    externalId: `ccbill:${crypto.randomUUID()}`,
  };
}

export async function cancelAtPeriodEnd(externalSubscriptionId: string): Promise<void> {
  if (!isConfigured()) throw new Error("ccbill_not_configured");
  void externalSubscriptionId;
  // TODO: call CCBill DataLink API when live.
}

// Import crypto at module bottom to avoid a top-of-file import when the
// adapter is only ever consulted via isConfigured() (which is cheap).
import crypto from "node:crypto";
