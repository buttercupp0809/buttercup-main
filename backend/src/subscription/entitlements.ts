// Single read-only resolver for "what can this user do right now, and
// how much is left". Chat/media entry points (Phase 21) and the billing
// UI (via /billing/entitlements) both call this. It NEVER increments;
// mutation lives in Phase 21.

import { prisma } from "@poppy/database";
import {
  FREE_MESSAGE_LIMIT,
  PLANS,
  isPaidPlan,
  isPlan,
  isUnlimited,
  type Plan,
} from "./plans";
import { counterTypeFor, planPeriodKey, type PlanCounterKind } from "./period";

export interface QuotaBucket {
  limit: number; // -1 = unlimited
  used: number;
  remaining: number; // -1 sentinel for unlimited
}

export interface Entitlements {
  plan: Plan;
  active: boolean; // true iff a paid pass is active and not expired
  expiresAt: string | null;
  chats: QuotaBucket;
  images: QuotaBucket;
  videos: QuotaBucket;
  freeMessagesUsed: number;
}

// Sentinel used both for `limit` (from PLANS) and for `remaining` when a
// plan grants unlimited usage. The UI checks `limit === -1` to render
// "Unlimited"; callers checking remaining must call isUnlimited first.
const UNLIMITED_REMAINING = -1;

function bucket(limit: number, used: number): QuotaBucket {
  if (isUnlimited(limit)) {
    return { limit, used, remaining: UNLIMITED_REMAINING };
  }
  return { limit, used, remaining: Math.max(0, limit - used) };
}

async function usageForPlan(
  userId: string,
  plan: Plan,
  currentPeriodEnd: Date | null,
): Promise<Record<PlanCounterKind, number>> {
  const key = planPeriodKey(plan, currentPeriodEnd);
  const rows = await prisma.usageCounter.findMany({
    where: {
      userId,
      period: key,
      counterType: { in: (["chat", "image", "video"] as PlanCounterKind[]).map(counterTypeFor) },
    },
  });
  const out: Record<PlanCounterKind, number> = { chat: 0, image: 0, video: 0 };
  for (const r of rows) {
    if (r.counterType === "chat" || r.counterType === "image" || r.counterType === "video") {
      out[r.counterType] = r.count;
    }
  }
  return out;
}

export async function entitlementsFor(userId: string, now: Date = new Date()): Promise<Entitlements> {
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { freeMessagesUsed: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    }),
  ]);
  const freeMessagesUsed = user?.freeMessagesUsed ?? 0;

  // Resolve the active plan. A paid pass is active only when the
  // subscription row says so AND its expiry (if present) is in the future.
  // Any expired / canceled / missing row falls back to free.
  const subPlan = sub?.plan;
  const paidActive =
    isPlan(subPlan) &&
    isPaidPlan(subPlan) &&
    sub?.status === "active" &&
    (sub.currentPeriodEnd == null || sub.currentPeriodEnd.getTime() > now.getTime());

  if (paidActive) {
    const plan = subPlan as Plan;
    const cfg = PLANS[plan];
    const usage = await usageForPlan(userId, plan, sub!.currentPeriodEnd);
    return {
      plan,
      active: true,
      expiresAt: sub!.currentPeriodEnd?.toISOString() ?? null,
      chats: bucket(cfg.chats, usage.chat),
      images: bucket(cfg.images, usage.image),
      videos: bucket(cfg.videos, usage.video),
      freeMessagesUsed,
    };
  }

  // Free plan: chats use the lifetime counter on User; media is 0.
  const freeCfg = PLANS.free;
  return {
    plan: "free",
    active: false,
    expiresAt: null,
    chats: bucket(FREE_MESSAGE_LIMIT, freeMessagesUsed),
    images: bucket(freeCfg.images, 0),
    videos: bucket(freeCfg.videos, 0),
    freeMessagesUsed,
  };
}
