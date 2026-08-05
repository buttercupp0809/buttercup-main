import { describe, expect, it } from "vitest";
import { validateStep, getStep, CHARACTER_STEPS } from "./steps";

describe("wizard step validation", () => {
  it("style step blocks empty draft", () => {
    const r = validateStep(getStep("style"), {});
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.style).toBeDefined();
  });

  it("style step passes with a valid style", () => {
    expect(validateStep(getStep("style"), { style: "anime" }).ok).toBe(true);
  });

  it("identity step rejects age < 18", () => {
    const r = validateStep(getStep("identity"), { name: "Aria", age: 17, gender: "F" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.age).toContain("18");
  });

  it("identity step passes with age >= 18 and required fields", () => {
    const r = validateStep(getStep("identity"), { name: "Aria", age: 24, gender: "F" });
    expect(r.ok).toBe(true);
  });

  it("appearance step requires stylePrompt + traits", () => {
    const bad = validateStep(getStep("appearance"), {});
    expect(bad.ok).toBe(false);
    const good = validateStep(getStep("appearance"), {
      stylePrompt: "soft light",
      traits: { hair: "auburn" },
    });
    expect(good.ok).toBe(true);
  });

  it("personality step needs backstory + traits + greeting + voice + bio", () => {
    const bad = validateStep(getStep("personality"), {});
    expect(bad.ok).toBe(false);
    const good = validateStep(getStep("personality"), {
      backstory: "grew up sailing",
      traitTags: ["curious", "warm"],
      behavioralInstructions: "ask small questions",
      greeting: "Hi there.",
      voiceProfile: { provider: "elevenlabs", voiceId: "warm-alto" },
      bio: "quiet, curious, kind",
    });
    expect(good.ok).toBe(true);
  });

  it("publish step requires visibility + rating", () => {
    expect(validateStep(getStep("publish"), {}).ok).toBe(false);
    expect(
      validateStep(getStep("publish"), { visibility: "private", contentRating: "sfw" }).ok,
    ).toBe(true);
  });

  it("CHARACTER_STEPS is ordered style -> identity -> appearance -> personality -> publish", () => {
    expect(CHARACTER_STEPS.map((s) => s.key)).toEqual([
      "style",
      "identity",
      "appearance",
      "personality",
      "publish",
    ]);
  });
});
