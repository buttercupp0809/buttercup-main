import { describe, expect, it } from "vitest";
import { ConsentAcceptDto } from "./consent";

describe("ConsentAcceptDto", () => {
  const base = {
    policyVersion: "2026-08-15",
    tosAccepted: true as const,
    privacyAccepted: true as const,
    ageConfirmed: true as const,
  };

  it("accepts a payload with all three boxes true", () => {
    const res = ConsentAcceptDto.safeParse(base);
    expect(res.success).toBe(true);
  });

  it("rejects when tosAccepted is false", () => {
    const res = ConsentAcceptDto.safeParse({ ...base, tosAccepted: false as unknown as true });
    expect(res.success).toBe(false);
  });

  it("rejects when privacyAccepted is false", () => {
    const res = ConsentAcceptDto.safeParse({ ...base, privacyAccepted: false as unknown as true });
    expect(res.success).toBe(false);
  });

  it("rejects when ageConfirmed is false", () => {
    const res = ConsentAcceptDto.safeParse({ ...base, ageConfirmed: false as unknown as true });
    expect(res.success).toBe(false);
  });

  it("rejects an empty policyVersion", () => {
    const res = ConsentAcceptDto.safeParse({ ...base, policyVersion: "" });
    expect(res.success).toBe(false);
  });

  it("rejects a missing policyVersion", () => {
    const { policyVersion: _omit, ...rest } = base;
    const res = ConsentAcceptDto.safeParse(rest);
    expect(res.success).toBe(false);
  });
});
