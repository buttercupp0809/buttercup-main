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

// Time-based circuit breaker. A failing adapter is skipped for
// COOLDOWN_MS, then automatically retried. Permanent-unhealthy was the
// previous behaviour but it caused ALL payments to fail for the rest of
// the process lifetime when only one provider is configured.
const COOLDOWN_MS = 30_000;
const cooldowns = new Map<PaymentProvider, number>();

function isUnhealthy(p: PaymentProvider): boolean {
  const t = cooldowns.get(p);
  if (t === undefined) return false;
  if (Date.now() - t < COOLDOWN_MS) return true;
  cooldowns.delete(p);
  return false;
}

export function resetProviderHealth(): void {
  cooldowns.clear();
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
    if (isUnhealthy(p)) continue;
    const adapter = ADAPTERS[p];
    if (!adapter.isConfigured()) continue;
    try {
      const resp = await adapter.createCheckout(req);
      assertMatureCompatibleProvider(resp.provider);
      return resp;
    } catch (err) {
      const extra: Record<string, unknown> = { message: (err as Error).message };
      if (err && typeof err === "object") {
        if ("status" in err) extra.httpStatus = (err as { status: unknown }).status;
        if ("error" in err) extra.dodoError = (err as { error: unknown }).error;
      }
      logWarn("payments", `provider ${p} failed`, extra);
      cooldowns.set(p, Date.now());
      lastError = err;
    }
  }

  // Build a diagnostic message that includes the actual provider error body
  // so the frontend can surface it rather than just showing "no_provider".
  let reason = "no_provider_available";
  if (lastError instanceof Error) {
    reason = lastError.message;
    if (lastError && typeof lastError === "object" && "error" in lastError) {
      const body = (lastError as { error: unknown }).error;
      if (body) reason += ` | ${JSON.stringify(body)}`;
    }
  }
  throw new PaymentProviderUnavailableError(reason);
}
