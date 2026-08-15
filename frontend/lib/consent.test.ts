import { describe, expect, it } from "vitest";
import { needsConsent, POLICY_VERSION } from "./consent";

function baseUser() {
  return {
    ageVerifiedAt: new Date(),
    ageVerificationLevel: "self_declared",
    tosAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
    acceptedPolicyVersion: POLICY_VERSION,
  };
}

describe("needsConsent", () => {
  it("returns true on first login when acceptedPolicyVersion is null", () => {
    expect(needsConsent({ ...baseUser(), acceptedPolicyVersion: null })).toBe(true);
  });

  it("returns true when acceptedPolicyVersion is an old/stale version", () => {
    expect(needsConsent({ ...baseUser(), acceptedPolicyVersion: "2020-01-01" })).toBe(true);
  });

  it("returns true when ageVerifiedAt is null", () => {
    expect(needsConsent({ ...baseUser(), ageVerifiedAt: null })).toBe(true);
  });

  it('returns true when ageVerificationLevel is "none"', () => {
    expect(needsConsent({ ...baseUser(), ageVerificationLevel: "none" })).toBe(true);
  });

  it("returns true when tosAcceptedAt is null", () => {
    expect(needsConsent({ ...baseUser(), tosAcceptedAt: null })).toBe(true);
  });

  it("returns true when privacyAcceptedAt is null", () => {
    expect(needsConsent({ ...baseUser(), privacyAcceptedAt: null })).toBe(true);
  });

  it("returns false only when age stamps are present AND acceptedPolicyVersion matches POLICY_VERSION", () => {
    expect(needsConsent(baseUser())).toBe(false);
  });
});
