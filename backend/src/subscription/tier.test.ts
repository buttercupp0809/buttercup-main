import { describe, expect, it } from "vitest";
import { normalizeTier, isPaidUser, isPro } from "./tier";
import { getLimitsForTier, isUnlimited, UNLIMITED } from "./limits";
import { enforceFeature } from "./enforce";

describe("tier helpers", () => {
  it("normalizes unknown to free", () => {
    expect(normalizeTier("weird")).toBe("free");
    expect(normalizeTier(undefined)).toBe("free");
    expect(normalizeTier("premium")).toBe("premium");
    expect(normalizeTier("pro")).toBe("pro");
  });
  it("isPaidUser / isPro", () => {
    expect(isPaidUser("free")).toBe(false);
    expect(isPaidUser("premium")).toBe(true);
    expect(isPaidUser("pro")).toBe(true);
    expect(isPro("premium")).toBe(false);
    expect(isPro("pro")).toBe(true);
  });
});

describe("tier limits + feature gate", () => {
  it("free blocks voice + image + premiumModel", () => {
    expect(enforceFeature("free", "voice").allowed).toBe(false);
    expect(enforceFeature("free", "image").allowed).toBe(false);
    expect(enforceFeature("free", "premiumModel").allowed).toBe(false);
  });
  it("premium allows voice + image, blocks premiumModel", () => {
    expect(enforceFeature("premium", "voice").allowed).toBe(true);
    expect(enforceFeature("premium", "image").allowed).toBe(true);
    expect(enforceFeature("premium", "premiumModel").allowed).toBe(false);
  });
  it("pro allows everything", () => {
    expect(enforceFeature("pro", "voice").allowed).toBe(true);
    expect(enforceFeature("pro", "image").allowed).toBe(true);
    expect(enforceFeature("pro", "premiumModel").allowed).toBe(true);
  });
  it("pro has unlimited daily messages", () => {
    expect(isUnlimited(getLimitsForTier("pro").dailyMessages)).toBe(true);
  });
  it("UNLIMITED sentinel is -1", () => {
    expect(UNLIMITED).toBe(-1);
  });
});
