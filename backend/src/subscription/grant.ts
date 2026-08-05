// Monthly token grant. Called from a payment webhook when a tier renews
// or activates; safe to call more than once per period thanks to the
// (userId, refId) idempotency key.

import { prisma } from "@poppy/database";
import { refundTokens } from "../media/token-ledger";
import { getLimitsForTier } from "./limits";
import type { Tier } from "./tier";
import { planExpiryFrom, type Plan } from "./plans";

// A grant is idempotent per (userId, periodKey). We reuse refundTokens
// under the hood because both are positive-delta writes; only the reason
// differs.
export async function grantMonthlyTokens(userId: string, tier: Tier, periodKey: string): Promise<number> {
  const limit = getLimitsForTier(tier);
  if (limit.monthlyTokenGrant <= 0) return 0;
  const refId = `grant:${tier}:${periodKey}`;
  // Dedupe: skip if a ledger row already exists for this refId.
  const existing = await prisma.tokenLedger.findFirst({ where: { userId, refId, reason: "grant" } });
  if (existing) return 0;
  await refundTokens({
    userId,
    delta: limit.monthlyTokenGrant,
    reason: "grant",
    refId,
  });
  return limit.monthlyTokenGrant;
}

// Back-compat mapping: the legacy `tier` enum (free/premium/pro) is still
// consulted by Phase 10 features (voice/image gating, token grants,
// enforce.ts). Until enforce.ts is rewritten in Phase 21 to read plan
// entitlements directly, we keep both fields in sync. Daily and weekly
// map to "premium" (paid); monthly maps to "pro" (highest tier, no reason
// to withhold premium-model access from monthly subscribers).
export function tierForPlan(plan: Plan): Tier {
  if (plan === "monthly") return "pro";
  if (plan === "daily" || plan === "weekly") return "premium";
  return "free";
}

// Activate a duration pass. Upserts the Subscription row, sets the
// expiry, and keeps the legacy tier field in sync for back-compat.
// Idempotent per call (safe to invoke from a replayed webhook because
// recordEvent already dedupes at the event level).
export async function activatePlan(userId: string, plan: Plan, from: Date = new Date()): Promise<void> {
  const currentPeriodEnd = planExpiryFrom(plan, from);
  const tier = tierForPlan(plan);
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      provider: "internal",
      plan,
      tier,
      status: "active",
      currentPeriodEnd,
    },
    update: {
      plan,
      tier,
      status: "active",
      currentPeriodEnd,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { subscriptionTier: tier } });
}
