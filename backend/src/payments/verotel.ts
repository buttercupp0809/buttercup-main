import crypto from "node:crypto";
import type { CheckoutRequest, CheckoutResponse } from "./types";

export function isConfigured(): boolean {
  return Boolean(process.env.VEROTEL_SHOP_ID && process.env.VEROTEL_SIGNATURE_KEY);
}

export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
  if (!isConfigured()) throw new Error("verotel_not_configured");
  // Verotel FlexPay signed URL. Real integration signs with SHA-256 over
  // ordered params + signatureKey (see Verotel docs).
  const externalId = `verotel:${crypto.randomUUID()}`;
  return {
    provider: "verotel",
    checkoutUrl: `https://secure.verotel.com/startorder?shopID=${process.env.VEROTEL_SHOP_ID}&referenceID=${externalId}&successURL=${encodeURIComponent(req.successUrl)}`,
    externalId,
  };
}

export async function cancelAtPeriodEnd(externalSubscriptionId: string): Promise<void> {
  if (!isConfigured()) throw new Error("verotel_not_configured");
  void externalSubscriptionId;
}
