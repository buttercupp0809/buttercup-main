import { NextResponse } from "next/server";
import { prisma } from "@poppy/database";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

// Aggregates current tier, renewal date, token balance, and the
// derived-from-limits feature grid so the billing UI does not re-implement
// the matrix. Tier limits are inlined here to avoid importing from
// backend/ across the workspace boundary.
const TIER_LIMITS = {
  free: { dailyMessages: 30, voice: false, image: false, premiumModel: false, grant: 20 },
  premium: { dailyMessages: -1, voice: true, image: true, premiumModel: false, grant: 500 },
  pro: { dailyMessages: -1, voice: true, image: true, premiumModel: true, grant: 1500 },
} as const;

export async function GET() {
  const user = await requireAuth();
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  const tier = (user.subscriptionTier as keyof typeof TIER_LIMITS) ?? "free";
  return NextResponse.json({
    tier,
    status: sub?.status ?? "inactive",
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    tokenBalance: user.tokenBalance,
    limits: TIER_LIMITS[tier] ?? TIER_LIMITS.free,
  });
}
