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

export { UNLIMITED, isUnlimited };

export type Plan = "free" | "daily" | "weekly" | "monthly";

export const PLANS_ORDER: Plan[] = ["free", "daily", "weekly", "monthly"];

export interface PlanConfig {
  plan: Plan;
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: {
    plan: "free",
    label: "Free",
    priceUsd: 0,
    durationDays: 0,
    chats: 10, // Lifetime free trial. Real default, NOT a TUNE placeholder.
    images: 0,
    videos: 0,
  },
  daily: {
    plan: "daily",
    label: "Daily Pass",
    priceUsd: 1,
    durationDays: 1,
    // Sensible launch defaults so the billing tiles show real numbers. TUNE:
    // adjust these to your economics; this file is the single source of truth.
    chats: 150,
    images: 10,
    videos: 2,
  },
  weekly: {
    plan: "weekly",
    label: "Weekly Pass",
    priceUsd: 6,
    durationDays: 7,
    chats: 1200,
    images: 80,
    videos: 15,
  },
  monthly: {
    plan: "monthly",
    label: "Monthly Pass",
    priceUsd: 25,
    durationDays: 30,
    chats: 6000,
    images: 400,
    videos: 75,
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
