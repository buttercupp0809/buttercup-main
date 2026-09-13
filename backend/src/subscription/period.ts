// Plan period key: stable identifier for the current pass window so
// `UsageCounter.period` (unique per `userId, counterType, period`) rolls
// over automatically when a user buys a new pass (the new expiry mints a
// new key -> a fresh counter row -> quotas reset per pass).
//
// Free-plan CHAT usage is counted in `UsageCounter` under a per-UTC-day
// key produced by `freeChatPeriodKey` (15 chats per day, auto-renewing).
// The legacy lifetime column `User.freeMessagesUsed` is retained for
// backward compatibility but no longer gates chat.
//
// counterType strings coexist with Phase 10's legacy
// "chat_daily" / "image_daily" / "voice_daily"; do not remove those.

import type { Plan } from "./plans";

export type PlanCounterKind = "chat" | "image" | "video";

export function counterTypeFor(kind: PlanCounterKind): string {
  return kind;
}

// Recurring subscription plans reset quotas every calendar month regardless
// of the annual expiry, so their key is month-scoped. One-time passes keep
// the expiry-pinned behavior: a new purchase mints a new expiry and
// therefore a new key, so counters start from zero for that pass.
export function planPeriodKey(
  plan: Plan,
  currentPeriodEnd: Date | null,
  now: Date = new Date(),
): string {
  if (plan === "sub_monthly" || plan === "sub_yearly") {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${plan}:${yyyy}-${mm}`;
  }
  const stamp = currentPeriodEnd ? currentPeriodEnd.toISOString().slice(0, 10) : "none";
  return `${plan}:${stamp}`;
}

// Free-plan chat period. Rolls at UTC midnight so users get a fresh
// 15-chat allowance every calendar day. Stored under counterType "chat"
// so entitlements + enforce both use the same (userId, "chat", period)
// row that `consumePlanQuota` uses for paid plans; the period key is
// what keeps free and paid rows from colliding.
export function freeChatPeriodKey(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `free_daily:${yyyy}-${mm}-${dd}`;
}

// Next UTC midnight after `now`. Exposed as the free plan's `resetsAt`
// on the entitlements + paywall payloads so the frontend can render a
// live "resets in Xh Ym" countdown without duplicating the calendar math.
export function nextUtcMidnight(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return d;
}
