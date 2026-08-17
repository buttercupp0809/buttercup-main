// Dodo Payments adapter. Merchant-of-Record hosted checkout for the 3 duration
// passes (daily/weekly/monthly) and 3 token packs (pack_100/pack_500/pack_2000).
// Product ids come from env so no plan/price numbers are duplicated here; the
// SINGLE SOURCE OF TRUTH for pricing stays in subscription/plans.ts and
// webhooks/shared.ts (TOKEN_PACKS). Metadata is the contract between checkout
// and the webhook (the webhook trusts these, not a product-id reverse lookup).

import DodoPayments from "dodopayments";
import type { CheckoutRequest, CheckoutResponse } from "./types";

let _client: DodoPayments | null = null;

export function getClient(): DodoPayments | null {
  if (_client) return _client;
  const bearerToken = process.env.DODO_API_KEY;
  if (!bearerToken) return null;
  _client = new DodoPayments({
    bearerToken,
    webhookKey: process.env.DODO_WEBHOOK_KEY ?? null,
    environment:
      process.env.DODO_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode",
  });
  return _client;
}

// Test-only: reset the memoized client so a test that mutates process.env
// gets a fresh instance on the next call.
export function _resetClientForTests(): void {
  _client = null;
}

export function isConfigured(): boolean {
  return Boolean(process.env.DODO_API_KEY);
}

// Resolves a CheckoutRequest to a Dodo product id via env. Throws a loud
// error at checkout time when the matching env var is missing so a misconfig
// fails visibly rather than silently.
export function resolveProductId(req: CheckoutRequest): string {
  const key =
    req.intent === "tokens"
      ? `DODO_PRODUCT_${(req.tokenPackId ?? "").toUpperCase()}`
      : `DODO_PRODUCT_${(req.plan ?? "").toUpperCase()}`;
  const productId = process.env[key];
  if (!productId) {
    throw new Error(`dodo_missing_product:${key}`);
  }
  return productId;
}

export async function createCheckout(
  req: CheckoutRequest,
): Promise<CheckoutResponse> {
  const c = getClient();
  if (!c) throw new Error("dodo_not_configured");
  const productId = resolveProductId(req);

  const session = await c.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    return_url: req.successUrl,
    cancel_url: req.cancelUrl,
    // METADATA IS THE CONTRACT between checkout and webhook. The webhook trusts
    // these three keys (userId/intent/plan-or-tokenPackId), not a product-id
    // reverse lookup, which keeps the wiring resilient to product-id changes.
    metadata: {
      userId: req.userId,
      intent: req.intent,
      plan: req.plan ?? "",
      tokenPackId: req.tokenPackId ?? "",
    },
  });

  const url = session.checkout_url;
  if (!url) throw new Error("dodo_no_checkout_url");
  return {
    provider: "dodo",
    checkoutUrl: url,
    externalId: session.session_id,
  };
}

// Optional: only meaningful if the monthly plan is ever provisioned as a Dodo
// subscription product. Duration passes are one-time in ButterCupp so this is
// a no-op path for the default configuration.
export async function cancelAtPeriodEnd(externalSubscriptionId: string): Promise<void> {
  const c = getClient();
  if (!c) throw new Error("dodo_not_configured");
  await c.subscriptions.update(externalSubscriptionId, {
    cancel_at_next_billing_date: true,
    cancel_reason: "cancelled_by_customer",
  });
}

// Optional customer portal (subscription products only).
export async function getPortalUrl(customerId: string, returnUrl?: string): Promise<string> {
  const c = getClient();
  if (!c) throw new Error("dodo_not_configured");
  const portal = await c.customers.customerPortal.create(customerId, {
    return_url: returnUrl,
  });
  return portal.link;
}
