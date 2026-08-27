// SINGLE SOURCE OF TRUTH for per-plan quota numbers (chats / images / videos)
// and per-plan pricing / duration. plans.ts assembles PlanConfig entries from
// these constants; nothing else should hardcode plan numbers.
//
// Free is the lifetime free trial (5 chats total, 1 image allowance, no
// video). All other rows are the halved launch defaults; adjust here (and
// only here) to retune.

export interface PlanQuotaLimits {
  readonly chats: number;
  readonly images: number;
  readonly videos: number;
}

export interface PlanPricing {
  readonly priceUsd: number;
  readonly durationDays: number;
}

export interface PlanLimits extends PlanPricing, PlanQuotaLimits {}

export const PLAN_LIMITS = {
  free: {
    priceUsd: 0,
    durationDays: 0,
    chats: 5,
    images: 1,
    videos: 0,
  },
  daily: {
    priceUsd: 1,
    durationDays: 1,
    chats: 75,
    images: 5,
    videos: 1,
  },
  weekly: {
    priceUsd: 6,
    durationDays: 7,
    chats: 600,
    images: 40,
    videos: 8,
  },
  monthly: {
    priceUsd: 25,
    durationDays: 30,
    chats: 3000,
    images: 200,
    videos: 38,
  },
  sub_monthly: {
    priceUsd: 19.99,
    durationDays: 30,
    chats: 5000,
    images: 300,
    videos: 60,
  },
  sub_yearly: {
    priceUsd: 149,
    durationDays: 365,
    chats: 5000,
    images: 300,
    videos: 60,
  },
} as const satisfies Record<string, PlanLimits>;

export type PlanLimitKey = keyof typeof PLAN_LIMITS;
