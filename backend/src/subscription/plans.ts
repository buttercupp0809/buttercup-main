// Duration-pass plan constants. SINGLE SOURCE OF TRUTH for chats / images /
// videos / price / duration. Everything else (entitlements.ts, grant.ts,
// webhooks, enforce.ts in Phase 21, the billing UI via the /billing/plans
// endpoint) reads from here. Do NOT hardcode plan numbers anywhere else.
//
// Free is a lifetime free trial (10 chats total, no media). Daily/Weekly/
// Monthly are duration passes that grant a fixed quota for `durationDays`.
// Numbers for the paid plans are TUNE placeholders; the human sets the
// final values before launch.
//
// PLAN QUOTA TYPE: counterType strings map onto quota keys as follows:
//   "chat"  -> chats
//   "image" -> images
//   "video" -> videos
// These plan-scoped counter types coexist with Phase 10's legacy
// "chat_daily" / "image_daily" / "voice_daily" and DO NOT replace them.

import { UNLIMITED, isUnlimited } from "./limits";
import { PLAN_LIMITS } from "./plan-limits";

export { UNLIMITED, isUnlimited };
export { PLAN_LIMITS } from "./plan-limits";

export type Plan = "free" | "daily" | "weekly" | "monthly" | "sub_monthly" | "sub_yearly";

export const PLANS_ORDER: Plan[] = [
  "free",
  "daily",
  "weekly",
  "monthly",
  "sub_monthly",
  "sub_yearly",
];

export type BillingInterval = "month" | "year";

export interface PlanConfig {
  plan: Plan;
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
  // True for auto-renewing subscription products (sub_monthly, sub_yearly).
  // Undefined / false for one-time duration passes. The UI uses this flag to
  // split "Subscriptions" from "Passes"; the webhook / grant path treats
  // them identically (subscription.renewed already reactivates the plan).
  recurring?: boolean;
  // Cosmetic: lets the UI render "/mo" or "/yr" without deriving it from
  // durationDays. Only set for recurring plans.
  billingInterval?: BillingInterval;
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: {
    plan: "free",
    label: "Free",
    ...PLAN_LIMITS.free,
  },
  daily: {
    plan: "daily",
    label: "Daily Pass",
    ...PLAN_LIMITS.daily,
  },
  weekly: {
    plan: "weekly",
    label: "Weekly Pass",
    ...PLAN_LIMITS.weekly,
  },
  monthly: {
    plan: "monthly",
    label: "Monthly Pass",
    ...PLAN_LIMITS.monthly,
  },
  // Recurring subscription tiers. Quotas refresh every calendar month for
  // BOTH plans (see period.planPeriodKey), so the yearly plan is priced as
  // a discount on 12 months of the same monthly quota, not a full year of
  // quota granted up front. durationDays pins currentPeriodEnd / the
  // auto-renewal window; the monthly usage reset is orthogonal.
  sub_monthly: {
    plan: "sub_monthly",
    label: "Monthly Subscription",
    ...PLAN_LIMITS.sub_monthly,
    recurring: true,
    billingInterval: "month",
  },
  sub_yearly: {
    plan: "sub_yearly",
    label: "Yearly Subscription",
    ...PLAN_LIMITS.sub_yearly,
    recurring: true,
    billingInterval: "year",
  },
};

// Phase 21 imports this exact constant so the free-trial number lives in
// exactly ONE place.
export const FREE_MESSAGE_LIMIT = PLANS.free.chats;

const PLAN_SET: ReadonlySet<Plan> = new Set(PLANS_ORDER);

export function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && PLAN_SET.has(v as Plan);
}

export function normalizePlan(v: unknown): Plan {
  return isPlan(v) ? v : "free";
}

export function getPlanConfig(plan: Plan): PlanConfig {
  return PLANS[plan];
}

export function isPaidPlan(plan: Plan): boolean {
  return plan !== "free";
}

// Returns the expiry date for a purchased pass; null for free plans (or any
// plan with durationDays === 0). `from` defaults to now.
export function planExpiryFrom(plan: Plan, from: Date = new Date()): Date | null {
  const cfg = PLANS[plan];
  if (cfg.durationDays <= 0) return null;
  return new Date(from.getTime() + cfg.durationDays * 24 * 60 * 60 * 1000);
}
