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

// The expiry date pins the window. Any new purchase produces a new expiry
// and therefore a new key, so counters start from zero for that pass.
export function planPeriodKey(plan: Plan, currentPeriodEnd: Date | null): string {
  const stamp = currentPeriodEnd ? currentPeriodEnd.toISOString().slice(0, 10) : "none";
  return `${plan}:${stamp}`;
}
