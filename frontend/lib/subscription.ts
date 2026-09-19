// Single source of truth for "is this user on a paid plan?"
//
// A user is considered paid if they hold any of:
//   - subscriptionTier of "premium" or "pro" (recurring subscription)
//   - an active duration pass (daily/weekly/monthly) on Subscription.plan
//
// Both checks are needed because the two billing paths write to different
// columns: CCBill/Verotel webhooks update User.subscriptionTier for recurring
// subs, while duration passes set Subscription.plan + status.

export type PaidTier = "free" | "premium" | "pro";

export interface PassState {
  status: string;
  plan: string | null;
  currentPeriodEnd: Date | null;
}

export function isUserPaid(tier: PaidTier, sub: PassState | null): boolean {
  if (tier === "premium" || tier === "pro") return true;
  if (!sub || sub.status !== "active") return false;
  if (!sub.plan || sub.plan === "free") return false;
  return sub.currentPeriodEnd === null || sub.currentPeriodEnd.getTime() > Date.now();
}
