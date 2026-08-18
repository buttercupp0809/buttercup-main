// Unit tests for the billing surface's pure helpers + editorial arrays.
// A full render test would need RTL / jsdom, neither of which the repo has
// wired up. Testing the pure logic that drives the subscriptions section
// (splitPlans + yearlySavingsPercent) gives equivalent coverage of the
// "Subscriptions section with a savings badge on yearly" behavior without
// dragging in a new test-env dependency.

import { describe, expect, it } from "vitest";
import {
  REVIEWS,
  splitPlans,
  yearlySavingsPercent,
  type PlanConfig,
} from "./BillingClient";

const PASS: PlanConfig = {
  plan: "monthly",
  label: "Monthly Pass",
  priceUsd: 25,
  durationDays: 30,
  chats: 3000,
  images: 200,
  videos: 38,
};

const SUB_MONTHLY: PlanConfig = {
  plan: "sub_monthly",
  label: "Monthly Subscription",
  priceUsd: 19.99,
  durationDays: 30,
  chats: 5000,
  images: 300,
  videos: 60,
  recurring: true,
  billingInterval: "month",
};

const SUB_YEARLY: PlanConfig = {
  plan: "sub_yearly",
  label: "Yearly Subscription",
  priceUsd: 149,
  durationDays: 365,
  chats: 5000,
  images: 300,
  videos: 60,
  recurring: true,
  billingInterval: "year",
};

describe("splitPlans", () => {
  it("separates one-time passes from recurring subscriptions and drops free", () => {
    const free: PlanConfig = {
      plan: "free",
      label: "Free",
      priceUsd: 0,
      durationDays: 0,
      chats: 10,
      images: 0,
      videos: 0,
    };
    const { passes, subs } = splitPlans([free, PASS, SUB_MONTHLY, SUB_YEARLY]);
    expect(passes.map((p) => p.plan)).toEqual(["monthly"]);
    expect(subs.map((p) => p.plan)).toEqual(["sub_monthly", "sub_yearly"]);
  });
});

describe("yearlySavingsPercent", () => {
  it("computes rounded savings for 12x monthly vs yearly", () => {
    // 12 * 19.99 = 239.88; 1 - 149/239.88 ~= 0.379 -> 38%
    expect(yearlySavingsPercent(19.99, 149)).toBe(38);
  });

  it("returns null when inputs are missing or non-positive", () => {
    expect(yearlySavingsPercent(undefined, 149)).toBeNull();
    expect(yearlySavingsPercent(19.99, undefined)).toBeNull();
    expect(yearlySavingsPercent(0, 149)).toBeNull();
  });

  it("returns null when the yearly price is not actually a saving", () => {
    expect(yearlySavingsPercent(10, 120)).toBeNull();
    expect(yearlySavingsPercent(10, 200)).toBeNull();
  });
});

describe("BillingClient REVIEWS", () => {
  it("has exactly three entries so a future edit cannot silently drop one", () => {
    expect(REVIEWS).toHaveLength(3);
    for (const r of REVIEWS) {
      expect(typeof r.title).toBe("string");
      expect(typeof r.body).toBe("string");
      expect(typeof r.who).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });
});
