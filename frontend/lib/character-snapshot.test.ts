import { describe, expect, it } from "vitest";
import { buildCharacterSystemPrompt, moderateCharacter } from "./character-snapshot";
import type { CreateCharacterInput } from "@buttercupp/shared";

const DRAFT: CreateCharacterInput = {
  style: "anime",
  name: "Aria",
  age: 24,
  gender: "F",
  traits: { hair: "auburn", eye: "green", body: "slim", clothing: "linen dress", features: [] },
  stylePrompt: "warm cinematic",
  negativePrompt: "",
  referenceImageKeys: [],
  backstory: "grew up in a coastal town",
  traitTags: ["warm", "curious"],
  behavioralInstructions: "ask small questions before big ones",
  greeting: "Hey there, glad you stopped by.",
  voiceProfile: { provider: "elevenlabs", voiceId: "warm-alto" },
  bio: "quiet, curious, warm",
  visibility: "private",
  contentRating: "sfw",
};

describe("buildCharacterSystemPrompt", () => {
  it("is deterministic given the same input", () => {
    expect(buildCharacterSystemPrompt(DRAFT)).toBe(buildCharacterSystemPrompt({ ...DRAFT }));
  });
  it("includes persona, backstory, behavioral instructions, and greeting", () => {
    const out = buildCharacterSystemPrompt(DRAFT);
    expect(out).toContain("## Persona");
    expect(out).toContain("## Backstory");
    expect(out).toContain("grew up in a coastal town");
    expect(out).toContain("## Behavioral instructions");
    expect(out).toContain("ask small questions before big ones");
    expect(out).toContain("## Opening greeting");
    expect(out).toContain("Hey there, glad you stopped by.");
  });
});

describe("moderateCharacter", () => {
  it("passes a clean draft", () => {
    expect(moderateCharacter(DRAFT).ok).toBe(true);
  });
  it("rejects a draft mentioning minors", () => {
    const r = moderateCharacter({ ...DRAFT, bio: "she is a teen prodigy" });
    expect(r.ok).toBe(false);
  });
  it("rejects age < 18 (server belt)", () => {
    const r = moderateCharacter({ ...DRAFT, age: 16 });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("age"))).toBe(true);
  });
});
