// Server-side paywall + usage enforcement. Every consuming route calls
// assertCanConsume() BEFORE work; the client-side UI is decoration.
//
// Usage counters live in the UsageCounter table with a (userId,
// counterType, period) unique key so an INSERT..ON CONFLICT upsert is the
// atomic increment.

import { prisma } from "@buttercupp/database";
import { getLimitsForTier, isUnlimited, type TierLimits } from "./limits";
import { normalizeTier, type Tier } from "./tier";
import { MEDIA_TOKEN_COSTS, type MediaKind } from "@buttercupp/shared";
import { entitlementsFor, type Entitlements } from "./entitlements";
import {
  FREE_MESSAGE_LIMIT,
  PLANS,
  PLANS_ORDER,
  type Plan,
  type PlanConfig,
} from "./plans";
import { freeChatPeriodKey, planPeriodKey, type PlanCounterKind } from "./period";
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

export type CounterType = "chat_daily" | "image_daily" | "voice_daily" | "free_teaser_image";
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
  // ISO UTC timestamp of the next quota reset (free plan: next UTC
  // midnight; paid plans: null). Lets the paywall UI render a live
  // "resets in Xh Ym" countdown for the free-daily case.
  resetsAt: string | null;
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
    resetsAt: ent.resetsAt,
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

// In-chat image gate. Mirrors assertCanChat but for the "image" counter.
// Unlike assertCanConsumeMedia (which hard-blocks free users), free users get
// a small metered image allowance (PLANS.free.images), so this gate treats
// free and paid the same way: check limit vs used and paywall when the bucket
// is empty. Called BEFORE generateChatImage so a blocked user never burns GPU
// and the thrown PaywallError becomes the SSE `paywall` frame.
export async function assertCanImage(userId: string): Promise<void> {
  const ent = await entitlementsFor(userId);
  if (!isUnlimited(ent.images.limit) && ent.images.remaining <= 0) {
    incrementMetric("paywall_hit");
    if (ent.active) {
      incrementMetric("plan_quota_exhausted");
    } else {
      incrementMetric("free_trial_exhausted");
    }
    throw new PaywallError(
      ent.active ? "plan_image_quota_exhausted" : "free_trial_exhausted",
      402,
      paywallBody(ent.active ? "plan_quota" : "free_trial", "image", ent) as unknown as Record<string, unknown>,
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

// ---------------------------------------------------------------------------
// Free-tier teaser path. Called BEFORE the in-chat image generation for free
// users. Never throws a PaywallError: under the daily cap it allows a new
// generation; at/over cap it signals "reuse existing teaser". The first ask
// from a user who has no prior teaser is always allowed regardless of the
// counter value so the experience is never a dead end.
// ---------------------------------------------------------------------------

export const FREE_TEASER_DAILY_CAP = 25;

export type TeaserResult =
  | { action: "generate" }
  | { action: "reuse"; existingAssetId: string };

// Atomic increment of the teaser counter. Returns the NEW count after the
// increment (i.e. 1 for the first call today). The upsert compiles to an
// INSERT..ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count, so a
// burst of concurrent requests can never all read the same pre-increment
// value: each one gets a distinct post-increment count under the unique
// (userId, counterType, period) index.
export async function incrementTeaserCounter(userId: string): Promise<number> {
  const period = todayKey();
  const row = await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period } },
    create: { userId, counterType: "free_teaser_image", period, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

// Guard for free-user in-chat image requests. Returns a discriminated union:
//   { action: "generate" }                    -- enqueue a new job
//   { action: "reuse", existingAssetId: id }  -- serve a previous teaser
//
// Atomicity (I-1): the counter is incremented FIRST and the returned
// post-increment count is what decides generate-vs-reuse. This closes the
// read-then-write race where a burst of concurrent asks could all observe
// count < cap and each generate, overrunning the GPU safety cap. Because the
// upsert is a single atomic INCREMENT..RETURNING, exactly one caller sees
// count == cap+1 first; every caller past the cap is routed to reuse.
//
// The characterId parameter is optional; pass it when available so an
// over-cap user gets the most-recent ready teaser for that character.
// Falls through to "generate" when there is no prior teaser to reuse
// (so the very first request is always satisfied regardless of the cap).
//
// Callers MUST NOT separately call incrementTeaserCounter: this function
// already performs the (single) increment for the request.
export async function assertCanTease(
  userId: string,
  characterId?: string | null,
): Promise<TeaserResult> {
  const count = await incrementTeaserCounter(userId);

  if (count <= FREE_TEASER_DAILY_CAP) {
    return { action: "generate" };
  }

  // Over cap: look for the most-recent ready image asset for this user
  // (and optionally this character) so we can re-serve it as a locked teaser.
  // s3Key: { not: null } (M-2) ensures the reused asset has real bytes to
  // blur; a ready-but-keyless row would fall back to the gradient placeholder
  // instead of a real blurred image.
  const existing = await prisma.mediaAsset.findFirst({
    where: {
      userId,
      kind: "image",
      status: "ready",
      s3Key: { not: null },
      ...(characterId ? { characterId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    return { action: "reuse", existingAssetId: existing.id };
  }

  // No existing teaser: allow one generation regardless of the cap so the
  // first photo ask is never a dead end for a new user.
  return { action: "generate" };
}

// Atomic column increment on the legacy lifetime column. The daily free
// chat counter is now the authoritative gate (see `consumeFreeChatDaily`),
// but we keep incrementing this column for backward compatibility with
// dashboards and older callers. Two concurrent turns cannot lose an update
// because Prisma compiles `{ increment: 1 }` to
// `UPDATE ... SET freeMessagesUsed = freeMessagesUsed + 1`.
export async function consumeFreeMessage(userId: string): Promise<number> {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { freeMessagesUsed: { increment: 1 } },
    select: { freeMessagesUsed: true },
  });
  return u.freeMessagesUsed;
}

// Atomic upsert increment for the free-plan daily chat counter. Same
// (userId, counterType, period) unique index as `consumePlanQuota`, so the
// upsert is the atomic primitive under concurrent turns. Period rolls at
// UTC midnight (see `freeChatPeriodKey`), which is what gives free users a
// fresh 15-chat allowance every day.
export async function consumeFreeChatDaily(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const period = freeChatPeriodKey(now);
  const row = await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType: "chat", period } },
    create: { userId, counterType: "chat", period, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
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
      // Free path: authoritative counter is the per-UTC-day UsageCounter
      // row read back by `entitlementsFor`. We ALSO bump the legacy
      // lifetime column so existing dashboards and any older code paths
      // that still read `User.freeMessagesUsed` keep working.
      await consumeFreeChatDaily(userId);
      await consumeFreeMessage(userId);
    }
  } catch {
    // Swallow: we do not want a counter failure to look like a chat failure
    // to the user. Logs surface the error via prisma.
  }
}

// Success-path helper for the in-chat image path. Mirrors
// recordChatConsumption but always increments the "image" UsageCounter via
// consumePlanQuota. For paid users the increment lands under the plan's
// period key; for free users it lands under the stable "free:none" key that
// entitlementsFor reads back for the free image allowance. Best-effort: never
// throws, so a counter blip cannot look like an image failure to the user.
export async function recordImageConsumption(userId: string): Promise<void> {
  try {
    const ent = await entitlementsFor(userId);
    const expires = ent.expiresAt ? new Date(ent.expiresAt) : null;
    await consumePlanQuota(userId, "image", ent.plan, expires);
  } catch {
    // Swallow: a counter failure must not surface as an image failure.
    // Prisma logs surface the underlying error.
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
