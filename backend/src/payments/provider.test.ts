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

  it("assertMatureCompatibleProvider passes on ccbill/verotel/segpay/crypto", () => {
    for (const p of ADULT_PROVIDERS) {
      expect(() => assertMatureCompatibleProvider(p)).not.toThrow();
    }
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
});
