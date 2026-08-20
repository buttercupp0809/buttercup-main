// User-facing tier labels. Kept separate from the Prisma enum values so the
// display can rename tiers without touching billing logic. The stored enum
// values (`free`, `premium`, `pro`) are still used for feature gating
// (e.g. `premiumModel = tier === "pro"`); this map is display-only.
//
// Locked product decision (Plans/cursor-prompt/35-major-fixes-batch.md #3):
// every PAID tier renders as "Premium" in the UI, regardless of whether it
// is the daily-pass tier or the recurring pro tier.

export type SubscriptionTierValue = "free" | "premium" | "pro" | string;

export function tierLabel(tier: SubscriptionTierValue | null | undefined): string {
  const key = (tier ?? "free").toString().toLowerCase();
  if (key === "free") return "Free";
  return "Premium";
}

export function isPaidTier(tier: SubscriptionTierValue | null | undefined): boolean {
  const key = (tier ?? "free").toString().toLowerCase();
  return key !== "free";
}
