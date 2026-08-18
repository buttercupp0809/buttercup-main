import { describe, expect, it } from "vitest";
import {
  FREE_MESSAGE_LIMIT,
  PLANS,
  PLANS_ORDER,
  getPlanConfig,
  isPaidPlan,
  isPlan,
  planExpiryFrom,
  type Plan,
} from "../plans";
import { planPeriodKey } from "../period";

describe("PLANS constants", () => {
  it("has an entry for every plan", () => {
    for (const p of PLANS_ORDER) {
      expect(PLANS[p]).toBeDefined();
      expect(PLANS[p].plan).toBe(p);
    }
  });

  it("PLANS_ORDER covers every declared plan", () => {
    const keys = Object.keys(PLANS) as Plan[];
    expect(new Set(PLANS_ORDER)).toEqual(new Set(keys));
  });

  it("price + duration match the PRD", () => {
    expect(PLANS.free).toMatchObject({ priceUsd: 0, durationDays: 0 });
    expect(PLANS.daily).toMatchObject({ priceUsd: 1, durationDays: 1 });
    expect(PLANS.weekly).toMatchObject({ priceUsd: 6, durationDays: 7 });
    expect(PLANS.monthly).toMatchObject({ priceUsd: 25, durationDays: 30 });
    expect(PLANS.sub_monthly).toMatchObject({
      priceUsd: 19.99,
      durationDays: 30,
      chats: 5000,
      images: 300,
      videos: 60,
      recurring: true,
      billingInterval: "month",
    });
    expect(PLANS.sub_yearly).toMatchObject({
      priceUsd: 149,
      durationDays: 365,
      chats: 5000,
      images: 300,
      videos: 60,
      recurring: true,
      billingInterval: "year",
    });
    expect(PLANS.daily).toMatchObject({ chats: 75, images: 5, videos: 1 });
    expect(PLANS.weekly).toMatchObject({ chats: 600, images: 40, videos: 8 });
    expect(PLANS.monthly).toMatchObject({ chats: 3000, images: 200, videos: 38 });
  });

  it("PLANS_ORDER places the recurring subscriptions after monthly", () => {
    const idxMonthly = PLANS_ORDER.indexOf("monthly");
    const idxSubMonthly = PLANS_ORDER.indexOf("sub_monthly");
    const idxSubYearly = PLANS_ORDER.indexOf("sub_yearly");
    expect(idxMonthly).toBeGreaterThanOrEqual(0);
    expect(idxSubMonthly).toBeGreaterThan(idxMonthly);
    expect(idxSubYearly).toBeGreaterThan(idxSubMonthly);
  });

  it("FREE_MESSAGE_LIMIT is 10 and matches PLANS.free.chats", () => {
    expect(FREE_MESSAGE_LIMIT).toBe(10);
    expect(PLANS.free.chats).toBe(10);
  });

  it("TUNE placeholders are numeric even before final tuning", () => {
    for (const p of ["daily", "weekly", "monthly"] as const) {
      expect(typeof PLANS[p].chats).toBe("number");
      expect(typeof PLANS[p].images).toBe("number");
      expect(typeof PLANS[p].videos).toBe("number");
    }
  });

  it("isPaidPlan is true for every non-free plan", () => {
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("daily")).toBe(true);
    expect(isPaidPlan("weekly")).toBe(true);
    expect(isPaidPlan("monthly")).toBe(true);
    expect(isPaidPlan("sub_monthly")).toBe(true);
    expect(isPaidPlan("sub_yearly")).toBe(true);
  });

  it("isPlan validates the enum including recurring subscriptions", () => {
    expect(isPlan("daily")).toBe(true);
    expect(isPlan("sub_monthly")).toBe(true);
    expect(isPlan("sub_yearly")).toBe(true);
    expect(isPlan("nope")).toBe(false);
    expect(isPlan(null)).toBe(false);
  });

  it("getPlanConfig round-trips", () => {
    expect(getPlanConfig("weekly").priceUsd).toBe(6);
  });
});

describe("planExpiryFrom", () => {
  const t = new Date("2026-08-01T00:00:00.000Z");

  it("returns null for free", () => {
    expect(planExpiryFrom("free", t)).toBeNull();
  });

  it("adds durationDays for paid passes", () => {
    expect(planExpiryFrom("daily", t)!.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    expect(planExpiryFrom("weekly", t)!.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(planExpiryFrom("monthly", t)!.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("planPeriodKey", () => {
  it("is stable within a window and changes when expiry changes", () => {
    const a = new Date("2026-08-02T00:00:00.000Z");
    const b = new Date("2026-08-02T23:59:59.000Z");
    const c = new Date("2026-08-03T00:00:00.000Z");
    expect(planPeriodKey("daily", a)).toBe(planPeriodKey("daily", b));
    expect(planPeriodKey("daily", a)).not.toBe(planPeriodKey("daily", c));
  });

  it("free / null expiry produces a stable sentinel key", () => {
    expect(planPeriodKey("free", null)).toBe("free:none");
  });

  it("recurring subscriptions are keyed by calendar month, not by expiry", () => {
    // Far-future expiry (365d out) must not influence the key; only the
    // current month should.
    const farFuture = new Date("2099-12-31T00:00:00.000Z");
    const nowJan = new Date("2026-01-15T12:00:00.000Z");
    const nowFeb = new Date("2026-02-01T00:00:00.000Z");
    expect(planPeriodKey("sub_yearly", farFuture, nowJan)).toBe("sub_yearly:2026-01");
    expect(planPeriodKey("sub_yearly", farFuture, nowFeb)).toBe("sub_yearly:2026-02");
    expect(planPeriodKey("sub_monthly", farFuture, nowJan)).toBe("sub_monthly:2026-01");
  });

  it("monthly (one-time pass) still uses expiry-pinned behavior", () => {
    const expiry = new Date("2026-08-31T00:00:00.000Z");
    expect(planPeriodKey("monthly", expiry)).toBe("monthly:2026-08-31");
  });
});
