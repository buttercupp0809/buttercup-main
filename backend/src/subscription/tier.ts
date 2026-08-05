// Tier semantics. ButterCupp has THREE tiers (free / premium / pro), do NOT
// collapse to Pellow's two-tier scheme. Every enforcement check runs
// through these helpers so an accidental typo in a route can't invent a
// new tier string.

export type Tier = "free" | "premium" | "pro";

const VALID: Tier[] = ["free", "premium", "pro"];

export function normalizeTier(t: unknown): Tier {
  if (typeof t === "string" && (VALID as string[]).includes(t)) return t as Tier;
  return "free";
}

export function isPaidUser(t: Tier): boolean {
  return t === "premium" || t === "pro";
}

export function isPro(t: Tier): boolean {
  return t === "pro";
}
