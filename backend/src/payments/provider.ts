// Payment provider chain. Iterates configured adult processors in
// PAYMENT_PRIMARY_PROVIDER order, skips unconfigured/unhealthy ones,
// returns the first successful checkout URL. There is no Stripe adapter
// in this module; the ForbiddenProviders type in ./types makes that
// impossible to add without a compile error.

import {
  ADULT_PROVIDERS,
  PaymentProviderUnavailableError,
  type CheckoutRequest,
  type CheckoutResponse,
  type PaymentProvider,
} from "./types";
import * as ccbill from "./ccbill";
import * as verotel from "./verotel";
import * as segpay from "./segpay";
import * as crypto from "./crypto";

type Adapter = {
  isConfigured: () => boolean;
  createCheckout: (req: CheckoutRequest) => Promise<CheckoutResponse>;
};

const ADAPTERS: Record<PaymentProvider, Adapter> = {
  ccbill,
  verotel,
  segpay,
  crypto,
};

// Session-scoped health tracker (simple circuit breaker). A failing
// adapter is skipped for the rest of the process's uptime, or until
// resetProviderHealth() is called (tests).
const unhealthy = new Set<PaymentProvider>();
export function resetProviderHealth(): void {
  unhealthy.clear();
}

export function getProviderOrder(): PaymentProvider[] {
  const primary = process.env.PAYMENT_PRIMARY_PROVIDER as PaymentProvider | undefined;
  if (primary && ADULT_PROVIDERS.includes(primary)) {
    const rest = ADULT_PROVIDERS.filter((p) => p !== primary);
    return [primary, ...rest];
  }
  return ADULT_PROVIDERS;
}

// Guard: throws if the request/user is ever routed toward a mainstream
// processor. Since the ADULT_PROVIDERS list is the ONLY source, this is
// really a runtime assertion for future refactors.
export function assertMatureCompatibleProvider(provider: string): void {
  if (!ADULT_PROVIDERS.includes(provider as PaymentProvider)) {
    throw new Error(`forbidden_provider:${provider}`);
  }
}

export async function createCheckoutSession(req: CheckoutRequest): Promise<CheckoutResponse> {
  const order = getProviderOrder();
  let lastError: unknown;
  for (const p of order) {
    if (unhealthy.has(p)) continue;
    const adapter = ADAPTERS[p];
    if (!adapter.isConfigured()) continue;
    try {
      const resp = await adapter.createCheckout(req);
      assertMatureCompatibleProvider(resp.provider);
      return resp;
    } catch (err) {
      unhealthy.add(p);
      lastError = err;
    }
  }
  throw new PaymentProviderUnavailableError(
    lastError instanceof Error ? lastError.message : "no_provider_available",
  );
}
