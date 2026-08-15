// Cross-instance idempotent webhook processor. All provider handlers
// normalize to a NormalizedEvent then hand off here. Idempotency is
// provided by an INSERT on WebhookEvent with the (provider, eventId)
// unique index; a duplicate delivery loses the race and we short-circuit.

import { prisma } from "@buttercupp/database";
import { normalizeTier } from "../../subscription/tier";
import { grantMonthlyTokens, activatePlan, tierForPlan } from "../../subscription/grant";
import { isPlan } from "../../subscription/plans";
import { refundTokens } from "../../media/token-ledger";
import type { NormalizedEvent } from "../types";
import { logInfo } from "../../utils/log";

// Persist the event; return true if we are the first delivery, false if
// this eventId has already been processed.
export async function recordEvent(ev: NormalizedEvent): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: ev.provider,
        eventId: ev.eventId,
        eventType: ev.eventType,
        payload: ev.raw as object,
      },
    });
    return true;
  } catch (err) {
    // Prisma throws P2002 on unique-index violation -> already processed.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return false;
    }
    throw err;
  }
}

function periodKey(d: Date | undefined): string {
  const when = d ?? new Date();
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Token pack catalog. In production this comes from a config table; for
// now the map is co-located so a pack added here is billable end-to-end.
// SINGLE SOURCE OF TRUTH for pack credits/label/price: the token store UI
// reads this via GET /billing/token-packs rather than hardcoding numbers.
// priceUsd values are TUNE placeholders like PLANS in ../../subscription/plans.
export const TOKEN_PACKS: Record<string, { credits: number; label: string; priceUsd: number }> = {
  pack_100: { credits: 100, label: "100 tokens", priceUsd: 2 },
  pack_500: { credits: 500, label: "500 tokens", priceUsd: 8 },
  pack_2000: { credits: 2000, label: "2000 tokens", priceUsd: 25 },
};

export async function processSubscriptionEvent(ev: NormalizedEvent): Promise<{ applied: boolean; effect: string }> {
  logInfo("payments", `webhook ${ev.provider}/${ev.eventType} id=${ev.eventId}`, { userId: ev.userId });
  const first = await recordEvent(ev);
  if (!first) {
    logInfo("payments", `webhook ${ev.eventId} duplicate, skipped`);
    return { applied: false, effect: "duplicate" };
  }

  const t = ev.eventType;

  if (t === "subscription.activated" || t === "subscription.updated" || t === "subscription.created") {
    // Phase 20 preferred path: a duration-pass plan drives Subscription.plan
    // and currentPeriodEnd = now + durationDays via activatePlan.
    if (isPlan(ev.plan) && ev.plan !== "free") {
      const plan = ev.plan;
      await activatePlan(ev.userId, plan);
      // Provider + externalId are still useful for reconciliation; update
      // in a separate call so activatePlan stays plan-focused.
      await prisma.subscription.update({
        where: { userId: ev.userId },
        data: {
          provider: ev.provider,
          externalId: ev.externalSubscriptionId ?? null,
        },
      });
      const tier = tierForPlan(plan);
      await grantMonthlyTokens(
        ev.userId,
        tier,
        periodKey(new Date()),
      );
      logInfo("payments", `plan activated: ${plan}`, { userId: ev.userId });
      return { applied: true, effect: "plan_activated" };
    }

    // Legacy tier-only path (back-compat with Phase 10 processors that do
    // not send a plan). Untouched behavior.
    const tier = normalizeTier(ev.tier);
    await prisma.subscription.upsert({
      where: { userId: ev.userId },
      create: {
        userId: ev.userId,
        provider: ev.provider,
        tier,
        status: "active",
        currentPeriodEnd: ev.currentPeriodEnd ? new Date(ev.currentPeriodEnd) : null,
        externalId: ev.externalSubscriptionId ?? null,
      },
      update: {
        provider: ev.provider,
        tier,
        status: "active",
        currentPeriodEnd: ev.currentPeriodEnd ? new Date(ev.currentPeriodEnd) : null,
        externalId: ev.externalSubscriptionId ?? null,
      },
    });
    await prisma.user.update({ where: { id: ev.userId }, data: { subscriptionTier: tier } });
    await grantMonthlyTokens(
      ev.userId,
      tier,
      periodKey(ev.currentPeriodEnd ? new Date(ev.currentPeriodEnd) : new Date()),
    );
    logInfo("payments", `tier activated: ${tier}`, { userId: ev.userId });
    return { applied: true, effect: "tier_activated" };
  }

  if (t === "transaction.completed" && ev.tokenPackId) {
    const pack = TOKEN_PACKS[ev.tokenPackId];
    if (!pack) return { applied: false, effect: "unknown_pack" };
    await refundTokens({
      userId: ev.userId,
      delta: pack.credits,
      reason: "purchase",
      refId: `${ev.provider}:${ev.eventId}`,
    });
    return { applied: true, effect: "tokens_granted" };
  }

  if (t === "subscription.canceled" || t === "subscription.past_due" || t === "payment_failed") {
    // Downgrade path: mark subscription free-equivalent so entitlementsFor
    // resolves to free. We do NOT null out currentPeriodEnd; the past-due
    // check in entitlementsFor already treats an active-status + expired
    // date as inactive, and preserving the date is useful for support.
    await prisma.subscription.updateMany({
      where: { userId: ev.userId },
      data: {
        status: t.replace("subscription.", ""),
        plan: "free",
      },
    });
    await prisma.user.update({ where: { id: ev.userId }, data: { subscriptionTier: "free" } });
    logInfo("payments", `downgraded to free (${t})`, { userId: ev.userId });
    return { applied: true, effect: "downgraded_to_free" };
  }

  return { applied: false, effect: "no_op" };
}
