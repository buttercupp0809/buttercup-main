// Payment types. ButterCupp targets adult-friendly processors ONLY. Stripe and
// PayPal are structurally absent from this file so there is no path a
// mature account could reach a mainstream processor.

import type { Tier } from "../subscription/tier";
import type { Plan } from "../subscription/plans";

export type PaymentProvider = "ccbill" | "verotel" | "segpay" | "crypto" | "dodo";

export const ADULT_PROVIDERS: PaymentProvider[] = ["ccbill", "verotel", "segpay", "crypto", "dodo"];

// Compile-time proof that "stripe" / "paypal" are not valid values for the
// PaymentProvider type. Attempting to use them elsewhere would be a type
// error.
export type ForbiddenProviders = "stripe" | "paypal";
type AssertDisjoint = ForbiddenProviders extends PaymentProvider ? never : true;
const _assertDisjoint: AssertDisjoint = true;
void _assertDisjoint;

export interface CheckoutRequest {
  userId: string;
  intent: "subscription" | "tokens";
  tier?: Tier; // legacy path: kept for back-compat
  plan?: Plan; // Phase 20: duration-pass path (daily/weekly/monthly)
  tokenPackId?: string; // required for intent=tokens
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResponse {
  provider: PaymentProvider;
  checkoutUrl: string;
  externalId: string;
}

export type NormalizedEventType =
  | "subscription.created"
  | "subscription.activated"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.past_due"
  | "transaction.completed"
  | "payment_failed";

export interface NormalizedEvent {
  provider: PaymentProvider;
  eventId: string; // provider-native id, unique per event
  eventType: NormalizedEventType;
  userId: string;
  tier?: Tier;
  plan?: Plan; // Phase 20: when a duration pass is bought
  amount?: number; // cents
  currency?: string;
  currentPeriodEnd?: string; // ISO
  externalSubscriptionId?: string;
  tokenPackId?: string; // when intent=tokens
  raw: Record<string, unknown>;
}

export class PaymentProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PaymentProviderUnavailableError";
  }
}
