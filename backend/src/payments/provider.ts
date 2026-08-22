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
import { logWarn } from "../utils/log";
import * as ccbill from "./ccbill";
import * as verotel from "./verotel";
import * as segpay from "./segpay";
import * as crypto from "./crypto";
import * as dodo from "./dodo";

type Adapter = {
  isConfigured: () => boolean;
  createCheckout: (req: CheckoutRequest) => Promise<CheckoutResponse>;
};

const ADAPTERS: Record<PaymentProvider, Adapter> = {
  ccbill,
  verotel,
  segpay,
  crypto,
  dodo,
};

// No circuit breaker: with only one configured provider (Dodo), a
// circuit breaker causes 100% payment failure for the entire process
// lifetime. Every request retries the provider directly so the real
// error is always visible and payments recover as soon as Dodo does.
export function resetProviderHealth(): void {
  // no-op; kept so the /billing/reset-provider-health route compiles
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
  let attempted = false;

  for (const p of order) {
    const adapter = ADAPTERS[p];
    if (!adapter.isConfigured()) {
      logWarn("payments", `provider ${p} skipped: not configured`);
      continue;
    }
    attempted = true;
    try {
      const resp = await adapter.createCheckout(req);
      assertMatureCompatibleProvider(resp.provider);
      return resp;
    } catch (err) {
      const extra: Record<string, unknown> = {};
      if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        if (typeof e.message === "string") extra.message = e.message;
        if (e.status !== undefined) extra.httpStatus = e.status;
        if (e.error !== undefined) extra.dodoError = e.error;
      } else {
        extra.message = String(err);
      }
      logWarn("payments", `provider ${p} failed`, extra);
      lastError = err;
    }
  }

  // Build the most specific error reason possible for the frontend.
  // Avoid relying on instanceof Error — the SDK may bundle its own Error class.
  let reason: string;
  if (!attempted) {
    reason = "no_provider_configured";
  } else if (lastError === undefined) {
    reason = "no_provider_available";
  } else {
    const e = lastError as Record<string, unknown>;
    const msg = typeof e?.message === "string" ? e.message : String(lastError);
    const status = typeof e?.status === "number" ? `[HTTP ${e.status}] ` : "";
    const body = e?.error ? ` | ${JSON.stringify(e.error)}` : "";
    reason = `${status}${msg}${body}`;
  }
  throw new PaymentProviderUnavailableError(reason);
}
