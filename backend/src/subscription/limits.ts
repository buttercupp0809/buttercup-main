// Tier limit + feature matrix. Numbers reflect PRD §13. -1 means unlimited
// so a caller can pass through `isUnlimited(limit)` before comparing.
//
// Adjustments in this map propagate to enforce.ts + the billing UI without
// any code changes.

import type { Tier } from "./tier";

export const UNLIMITED = -1;
export const isUnlimited = (n: number): boolean => n === UNLIMITED;

export interface TierLimits {
  dailyMessages: number;
  premiumModel: boolean;
  memoryDepth: number; // rows retained per (user, character) before compaction
  voiceEnabled: boolean;
  imageEnabled: boolean;
  monthlyTokenGrant: number;
  priority: number; // 0 low, 2 high (affects queue priority in phase 07)
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    dailyMessages: 30,
    premiumModel: false,
    memoryDepth: 25,
    voiceEnabled: false,
    imageEnabled: false,
    monthlyTokenGrant: 20,
    priority: 0,
  },
  premium: {
    dailyMessages: UNLIMITED,
    premiumModel: false,
    memoryDepth: 200,
    voiceEnabled: true,
    imageEnabled: true,
    monthlyTokenGrant: 500,
    priority: 1,
  },
  pro: {
    dailyMessages: UNLIMITED,
    premiumModel: true,
    memoryDepth: UNLIMITED,
    voiceEnabled: true,
    imageEnabled: true,
    monthlyTokenGrant: 1500,
    priority: 2,
  },
};

export function getLimitsForTier(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}
