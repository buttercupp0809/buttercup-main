// Server-side paywall + usage enforcement. Every consuming route calls
// assertCanConsume() BEFORE work; the client-side UI is decoration.
//
// Usage counters live in the UsageCounter table with a (userId,
// counterType, period) unique key so an INSERT..ON CONFLICT upsert is the
// atomic increment.

import { prisma } from "@poppy/database";
import { getLimitsForTier, isUnlimited, type TierLimits } from "./limits";
import { normalizeTier, type Tier } from "./tier";
import { MEDIA_TOKEN_COSTS, type MediaKind } from "@poppy/shared";
import { entitlementsFor, type Entitlements } from "./entitlements";
import {
  FREE_MESSAGE_LIMIT,
  PLANS,
  PLANS_ORDER,
  type Plan,
  type PlanConfig,
} from "./plans";
import { planPeriodKey, type PlanCounterKind } from "./period";
import { incrementCounter as incrementMetric } from "../metrics";

export class PaywallError extends Error {
  constructor(
    public reason: string,
    public status = 402,
    public body: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = "PaywallError";
  }
}

export type CounterType = "chat_daily" | "image_daily" | "voice_daily";
export type Feature = "voice" | "image" | "premiumModel";

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function incrementCounter(userId: string, counterType: CounterType, period: string): Promise<number> {
  const row = await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType, period } },
    create: { userId, counterType, period, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

async function readCounter(userId: string, counterType: CounterType, period: string): Promise<number> {
  const row = await prisma.usageCounter.findUnique({
    where: { userId_counterType_period: { userId, counterType, period } },
  });
  return row?.count ?? 0;
}

export interface UsageCheck {
  allowed: boolean;
  current: number;
  limit: number;
  period: string;
}

// Non-mutating check. The chat/media path calls this before enqueue; the
// actual increment happens after the work is committed so a rejected
// request does not eat into the daily cap.
export async function checkUsageLimit(
  userId: string,
  counterType: CounterType,
  tier: Tier,
): Promise<UsageCheck> {
  const limits = getLimitsForTier(tier);
  const limit = counterType === "chat_daily" ? limits.dailyMessages : UNLIMITED;
  const period = todayKey();
  const current = await readCounter(userId, counterType, period);
  const allowed = isUnlimited(limit) || current < limit;
  return { allowed, current, limit, period };
}

export async function incrementUsage(
  userId: string,
  counterType: CounterType,
): Promise<number> {
  return incrementCounter(userId, counterType, todayKey());
}

export function enforceFeature(tier: Tier, feature: Feature): { allowed: boolean; reason?: string } {
  const l: TierLimits = getLimitsForTier(tier);
  if (feature === "voice" && !l.voiceEnabled) return { allowed: false, reason: "voice_requires_upgrade" };
  if (feature === "image" && !l.imageEnabled) return { allowed: false, reason: "image_requires_upgrade" };
  if (feature === "premiumModel" && !l.premiumModel) return { allowed: false, reason: "premium_model_requires_pro" };
  return { allowed: true };
}

export type ConsumeKind = MediaKind | "chat" | "premium_msg";

const UNLIMITED = -1;

// -----------------------------------------------------------------------------
// Phase 21: strict plan-model enforcement.
//
// All chat entry points call `assertCanChat` BEFORE `runChatTurn`. Both
// transports use the same helper so neither can bypass the other. Counters
// increment ONLY after a successful assistant reply via
// `recordChatConsumption`. Media enqueue calls `assertCanConsumeMedia` in
// addition to the existing token debit; plan quota consumption for media
// happens on terminal success in the worker.
// -----------------------------------------------------------------------------

export interface PaywallInfo {
  reason: string;
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number;
  plans: PlanConfig[];
  upgradeUrl: string;
}

function planCatalog(): PlanConfig[] {
  return PLANS_ORDER.map((p) => PLANS[p]);
}

// Shape a paywall body the client can render directly (three plan cards +
// scope-aware copy). Kept small; do not leak internal user state.
export function paywallBody(
  scope: PaywallInfo["scope"],
  kind: PaywallInfo["kind"],
  ent: Entitlements,
): PaywallInfo {
  const bucket = kind === "chat" ? ent.chats : kind === "image" ? ent.images : ent.videos;
  const reason =
    scope === "free_trial"
      ? "free_trial_exhausted"
      : `plan_${kind}_quota_exhausted`;
  return {
    reason,
    scope,
    kind,
    used: bucket.used,
    limit: bucket.limit,
    plans: planCatalog(),
    upgradeUrl: "/billing?upgrade=1",
  };
}

// Chat gate. Called BEFORE runChatTurn in both transports. Throws
// PaywallError on block; returns silently on allow.
export async function assertCanChat(userId: string): Promise<void> {
  const ent = await entitlementsFor(userId);
  if (ent.active) {
    if (!isUnlimited(ent.chats.limit) && ent.chats.remaining <= 0) {
      incrementMetric("paywall_hit");
      incrementMetric("plan_quota_exhausted");
      throw new PaywallError(
        "plan_chat_quota_exhausted",
        402,
        paywallBody("plan_quota", "chat", ent) as unknown as Record<string, unknown>,
      );
    }
    return;
  }
  // Free plan: gate on the lifetime free-message counter.
  if (ent.chats.remaining <= 0) {
    incrementMetric("paywall_hit");
    incrementMetric("free_trial_exhausted");
    throw new PaywallError(
      "free_trial_exhausted",
      402,
      paywallBody("free_trial", "chat", ent) as unknown as Record<string, unknown>,
    );
  }
}

// Media plan gate. Runs on top of the existing token-balance check in
// http/media.ts; the token debit stays separate so we do not double-charge.
export async function assertCanConsumeMedia(
  userId: string,
  kind: "image" | "video",
): Promise<void> {
  const ent = await entitlementsFor(userId);
  if (!ent.active) {
    incrementMetric("paywall_hit");
    incrementMetric("plan_quota_exhausted");
    throw new PaywallError(
      `plan_${kind}_quota_requires_plan`,
      402,
      paywallBody("plan_quota", kind, ent) as unknown as Record<string, unknown>,
    );
  }
  const bucket = kind === "image" ? ent.images : ent.videos;
  if (!isUnlimited(bucket.limit) && bucket.remaining <= 0) {
    incrementMetric("paywall_hit");
    incrementMetric("plan_quota_exhausted");
    throw new PaywallError(
      `plan_${kind}_quota_exhausted`,
      402,
      paywallBody("plan_quota", kind, ent) as unknown as Record<string, unknown>,
    );
  }
}

// Atomic column increment. `prisma.user.update` with a numeric increment
// compiles to `UPDATE ... SET freeMessagesUsed = freeMessagesUsed + 1`, so
// two concurrent turns cannot lose an update.
export async function consumeFreeMessage(userId: string): Promise<number> {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { freeMessagesUsed: { increment: 1 } },
    select: { freeMessagesUsed: true },
  });
  return u.freeMessagesUsed;
}

// Atomic upsert increment. Reuses the existing UsageCounter pattern; the
// unique (userId, counterType, period) index makes the upsert the atomic
// primitive for concurrent turns.
export async function consumePlanQuota(
  userId: string,
  kind: PlanCounterKind,
  plan: Plan,
  currentPeriodEnd: Date | null,
): Promise<number> {
  const period = planPeriodKey(plan, currentPeriodEnd);
  const row = await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType: kind, period } },
    create: { userId, counterType: kind, period, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

// Success-path helper for chat callers. Reads entitlements once and routes
// the increment to the right column. Never throws on quota (the caller has
// already generated the reply); best-effort so a counter blip cannot lose
// a successfully-delivered message.
export async function recordChatConsumption(userId: string): Promise<void> {
  try {
    const ent = await entitlementsFor(userId);
    if (ent.active && ent.plan !== "free") {
      const expires = ent.expiresAt ? new Date(ent.expiresAt) : null;
      await consumePlanQuota(userId, "chat", ent.plan, expires);
    } else {
      await consumeFreeMessage(userId);
    }
  } catch {
    // Swallow: we do not want a counter failure to look like a chat failure
    // to the user. Logs surface the error via prisma.
  }
}

export { FREE_MESSAGE_LIMIT };

// Combined feature-gate + token-balance check. Throws PaywallError so a
// route handler can `catch` and return a normalized paywall response body.
export async function assertCanConsume(userId: string, kind: ConsumeKind): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, tokenBalance: true },
  });
  if (!user) throw new PaywallError("user_not_found", 401);
  const tier = normalizeTier(user.subscriptionTier);

  if (kind === "chat") {
    const check = await checkUsageLimit(userId, "chat_daily", tier);
    if (!check.allowed) {
      throw new PaywallError("daily_message_limit", 402, {
        current: check.current,
        limit: check.limit,
        upgradeUrl: "/billing?upgrade=1",
      });
    }
    return;
  }

  if (kind === "premium_msg") {
    const ff = enforceFeature(tier, "premiumModel");
    if (!ff.allowed) {
      throw new PaywallError(ff.reason ?? "premium_model_blocked", 402, {
        upgradeUrl: "/billing?upgrade=1",
      });
    }
    return;
  }

  // Media kinds: check the feature gate + the token balance.
  const feature: Feature = kind === "voice" ? "voice" : "image";
  const ff = enforceFeature(tier, feature);
  if (!ff.allowed) {
    throw new PaywallError(ff.reason ?? "feature_blocked", 402, {
      upgradeUrl: "/billing?upgrade=1",
    });
  }
  const cost = MEDIA_TOKEN_COSTS[kind];
  if (user.tokenBalance < cost) {
    throw new PaywallError("insufficient_tokens", 402, {
      required: cost,
      balance: user.tokenBalance,
      buyTokensUrl: "/billing/tokens",
    });
  }
}
