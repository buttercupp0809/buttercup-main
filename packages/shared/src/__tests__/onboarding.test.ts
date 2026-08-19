import { describe, expect, it } from "vitest";
import {
  onboardingIdentitySchema,
  onboardingTasteSchema,
  onboardingPickSchema,
  onboardingInputSchema,
} from "../onboarding";

describe("onboardingIdentitySchema", () => {
  it("rejects an empty displayName", () => {
    const r = onboardingIdentitySchema.safeParse({ displayName: "", gender: "woman" });
    expect(r.success).toBe(false);
  });

  it("rejects an oversized displayName", () => {
    const r = onboardingIdentitySchema.safeParse({
      displayName: "a".repeat(49),
      gender: "woman",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-enum gender", () => {
    const r = onboardingIdentitySchema.safeParse({ displayName: "Ari", gender: "alien" });
    expect(r.success).toBe(false);
  });

  it("accepts a valid identity slice", () => {
    const r = onboardingIdentitySchema.safeParse({ displayName: "Ari", gender: "nonbinary" });
    expect(r.success).toBe(true);
  });
});

describe("onboardingTasteSchema", () => {
  it("requires at least one interest", () => {
    const r = onboardingTasteSchema.safeParse({ vibe: "cozy", interests: [] });
    expect(r.success).toBe(false);
  });

  it("caps interests at 8", () => {
    const r = onboardingTasteSchema.safeParse({
      vibe: "cozy",
      interests: Array.from({ length: 9 }, (_, i) => `interest-${i}`),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-enum vibe", () => {
    const r = onboardingTasteSchema.safeParse({ vibe: "chaotic", interests: ["hiking"] });
    expect(r.success).toBe(false);
  });

  it("accepts a valid taste slice", () => {
    const r = onboardingTasteSchema.safeParse({ vibe: "supportive", interests: ["hiking", "sci-fi"] });
    expect(r.success).toBe(true);
  });
});

describe("onboardingPickSchema", () => {
  it("accepts a valid uuid", () => {
    expect(
      onboardingPickSchema.safeParse({ firstCharacterId: "550e8400-e29b-41d4-a716-446655440000" })
        .success,
    ).toBe(true);
  });

  it("accepts null", () => {
    expect(onboardingPickSchema.safeParse({ firstCharacterId: null }).success).toBe(true);
  });

  it("accepts an absent field", () => {
    expect(onboardingPickSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(onboardingPickSchema.safeParse({ firstCharacterId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("onboardingInputSchema", () => {
  const validFull = {
    displayName: "Ari",
    gender: "woman" as const,
    vibe: "flirty" as const,
    interests: ["music", "travel"],
    firstCharacterId: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("accepts a valid full draft", () => {
    expect(onboardingInputSchema.safeParse(validFull).success).toBe(true);
  });

  it("treats firstCharacterId as optional (absent)", () => {
    const { firstCharacterId: _unused, ...rest } = validFull;
    void _unused;
    expect(onboardingInputSchema.safeParse(rest).success).toBe(true);
  });

  it("treats firstCharacterId as nullable", () => {
    expect(
      onboardingInputSchema.safeParse({ ...validFull, firstCharacterId: null }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid firstCharacterId", () => {
    expect(
      onboardingInputSchema.safeParse({ ...validFull, firstCharacterId: "nope" }).success,
    ).toBe(false);
  });
});
