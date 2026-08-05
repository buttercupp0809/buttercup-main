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

  it("isPaidPlan is true for daily/weekly/monthly, false for free", () => {
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("daily")).toBe(true);
    expect(isPaidPlan("weekly")).toBe(true);
    expect(isPaidPlan("monthly")).toBe(true);
  });

  it("isPlan validates the enum", () => {
    expect(isPlan("daily")).toBe(true);
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
});
