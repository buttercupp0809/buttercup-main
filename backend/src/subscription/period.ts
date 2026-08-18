// Plan period key: stable identifier for the current pass window so
// `UsageCounter.period` (unique per `userId, counterType, period`) rolls
// over automatically when a user buys a new pass (the new expiry mints a
// new key -> a fresh counter row -> quotas reset per pass).
//
// Free-plan chat usage is NOT counted here; it lives on
// `User.freeMessagesUsed` and is a lifetime counter. `planPeriodKey` is
// only meaningful for paid plans.
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
