import { describe, expect, it } from "vitest";
import { getProviderOrder, assertMatureCompatibleProvider } from "./provider";
import { ADULT_PROVIDERS } from "./types";

describe("payment provider mature guard", () => {
  it("ADULT_PROVIDERS excludes stripe and paypal", () => {
    expect(ADULT_PROVIDERS.some((p) => (p as string) === "stripe")).toBe(false);
    expect(ADULT_PROVIDERS.some((p) => (p as string) === "paypal")).toBe(false);
  });

  it("assertMatureCompatibleProvider throws on stripe", () => {
    expect(() => assertMatureCompatibleProvider("stripe")).toThrow(/forbidden_provider/);
    expect(() => assertMatureCompatibleProvider("paypal")).toThrow(/forbidden_provider/);
  });

  it("assertMatureCompatibleProvider passes on ccbill/verotel/segpay/crypto/dodo", () => {
    for (const p of ADULT_PROVIDERS) {
      expect(() => assertMatureCompatibleProvider(p)).not.toThrow();
    }
  });

  it("ADULT_PROVIDERS includes dodo (Phase 32)", () => {
    expect(ADULT_PROVIDERS).toContain("dodo");
  });

  it("assertMatureCompatibleProvider passes on dodo", () => {
    expect(() => assertMatureCompatibleProvider("dodo")).not.toThrow();
  });

  it("getProviderOrder respects PAYMENT_PRIMARY_PROVIDER", () => {
    const prev = process.env.PAYMENT_PRIMARY_PROVIDER;
    process.env.PAYMENT_PRIMARY_PROVIDER = "verotel";
    try {
      expect(getProviderOrder()[0]).toBe("verotel");
    } finally {
      if (prev === undefined) delete process.env.PAYMENT_PRIMARY_PROVIDER;
      else process.env.PAYMENT_PRIMARY_PROVIDER = prev;
    }
  });

  it("getProviderOrder puts dodo first when PAYMENT_PRIMARY_PROVIDER=dodo (Phase 32)", () => {
    const prev = process.env.PAYMENT_PRIMARY_PROVIDER;
    process.env.PAYMENT_PRIMARY_PROVIDER = "dodo";
    try {
      const order = getProviderOrder();
      expect(order[0]).toBe("dodo");
      // Fallbacks remain in the list so a Dodo outage still routes to ccbill etc.
      expect(order).toContain("ccbill");
      expect(order).toContain("verotel");
      expect(order).toContain("segpay");
      expect(order).toContain("crypto");
    } finally {
      if (prev === undefined) delete process.env.PAYMENT_PRIMARY_PROVIDER;
      else process.env.PAYMENT_PRIMARY_PROVIDER = prev;
    }
  });
});
