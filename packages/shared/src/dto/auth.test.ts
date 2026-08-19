import { describe, expect, it } from "vitest";
import {
  SignupDto,
  LoginDto,
  AgeGateDto,
  MIN_AGE_YEARS,
  computeAgeYears,
  passwordChecklist,
} from "./auth";

function dobForAge(age: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

describe("computeAgeYears", () => {
  it("returns full years, respecting the day-of-year cutoff", () => {
    const today = new Date(Date.UTC(2026, 6, 30));
    const dob18 = new Date(Date.UTC(2008, 6, 30));
    const dob17 = new Date(Date.UTC(2008, 6, 31));
    expect(computeAgeYears(dob18, today)).toBe(18);
    expect(computeAgeYears(dob17, today)).toBe(17);
  });
});

describe("SignupDto", () => {
  const base = {
    email: "user@example.com",
    password: "Correct-horse4Battery",
    jurisdiction: "us",
    tosAccepted: true as const,
    privacyAccepted: true as const,
  };

  it("normalizes email and jurisdiction", () => {
    const res = SignupDto.safeParse({ ...base, email: "  USER@Example.COM  " });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe("user@example.com");
      expect(res.data.jurisdiction).toBe("US");
    }
  });

  it("rejects short/weak passwords", () => {
    const res = SignupDto.safeParse({ ...base, password: "short1" });
    expect(res.success).toBe(false);
  });

  it.each([
    ["under-12 length", "Ab1!short"],
    ["missing uppercase", "correct-horse4battery"],
    ["missing lowercase", "CORRECT-HORSE4BATTERY"],
    ["missing digit", "Correct-horse!battery"],
    ["missing symbol", "Correcthorse4battery"],
  ])("rejects password: %s", (_label, pw) => {
    const res = SignupDto.safeParse({ ...base, password: pw });
    expect(res.success).toBe(false);
  });

  it("accepts a strong password (>=12, upper+lower+digit+symbol)", () => {
    const res = SignupDto.safeParse({ ...base, password: "Correct-horse4Battery" });
    expect(res.success).toBe(true);
  });

  it("rejects when tos or privacy not accepted", () => {
    const missingTos = SignupDto.safeParse({ ...base, tosAccepted: false as unknown as true });
    const missingPriv = SignupDto.safeParse({ ...base, privacyAccepted: false as unknown as true });
    expect(missingTos.success).toBe(false);
    expect(missingPriv.success).toBe(false);
  });
});

describe("LoginDto (lenient)", () => {
  it("accepts a legacy short password so pre-upgrade users still sign in", () => {
    const res = LoginDto.safeParse({ email: "user@example.com", password: "oldpw" });
    expect(res.success).toBe(true);
  });
  it("rejects empty password", () => {
    const res = LoginDto.safeParse({ email: "user@example.com", password: "" });
    expect(res.success).toBe(false);
  });
});

describe("passwordChecklist", () => {
  it("flags failing rules and passing rules for a mixed input", () => {
    const result = passwordChecklist("Aa1"); // short, missing symbol
    const map = Object.fromEntries(result.map((r) => [r.id, r.ok]));
    expect(map.upper).toBe(true);
    expect(map.lower).toBe(true);
    expect(map.digit).toBe(true);
    expect(map.symbol).toBe(false);
    expect(map.min).toBe(false);
  });
  it("all-ok for a strong password", () => {
    const result = passwordChecklist("Correct-horse4Battery");
    expect(result.every((r) => r.ok)).toBe(true);
  });
});

describe("AgeGateDto", () => {
  it("rejects under-18 dob", () => {
    const res = AgeGateDto.safeParse({
      dob: dobForAge(17),
      jurisdiction: "US",
      tosAccepted: true,
      privacyAccepted: true,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a compliant payload", () => {
    const res = AgeGateDto.safeParse({
      dob: dobForAge(21),
      jurisdiction: "US",
      tosAccepted: true,
      privacyAccepted: true,
    });
    expect(res.success).toBe(true);
  });
});
