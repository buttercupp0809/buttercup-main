// Optional crypto adapter (Coinbase Commerce or similar). Kept behind the
// same interface as the fiat processors so the failover chain does not
// distinguish. Real integration replaces the stub URL with a call to the
// hosted-checkout API.

import type { CheckoutRequest, CheckoutResponse } from "./types";

export function isConfigured(): boolean {
  return Boolean(process.env.COINBASE_COMMERCE_API_KEY);
}

export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
  if (!isConfigured()) throw new Error("crypto_not_configured");
  return {
    provider: "crypto",
    checkoutUrl: `https://commerce.coinbase.com/checkout/PLACEHOLDER?userId=${req.userId}`,
    externalId: `crypto:${Date.now()}`,
  };
}

export async function cancelAtPeriodEnd(externalSubscriptionId: string): Promise<void> {
  void externalSubscriptionId;
}
