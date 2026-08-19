import { describe, expect, it } from "vitest";
import { buildImagePrompt, buildImageCaption } from "./prompt";
import { shouldSendImage } from "./decision";
import { assertCharacterAdult, rejectMinorReference, ImageSafetyError } from "./safety";
import { SAFETY_NEGATIVE } from "./constants";

const SHEET = {
  stylePrompt: "cinematic portrait, soft light",
  negativePrompt: "blurry, extra fingers",
  traits: {
    hair: "auburn",
    eye: "green",
    body: "athletic",
    clothing: "linen dress",
    features: ["freckles", "small scar over left eyebrow"],
  },
};

describe("buildImagePrompt", () => {
  it("includes stylePrompt, traits, and scene in the positive prompt", () => {
    const { prompt } = buildImagePrompt({
      appearanceSheet: SHEET,
      style: "realistic",
      userRequest: "selfie in a cafe",
    });
    expect(prompt).toContain("cinematic portrait");
    expect(prompt).toContain("hair: auburn");
    expect(prompt).toContain("eyes: green");
    expect(prompt).toContain("scene: selfie in a cafe");
  });
  it("always appends SAFETY_NEGATIVE to the negative prompt", () => {
    const { negativePrompt } = buildImagePrompt({
      appearanceSheet: SHEET,
      style: "realistic",
      userRequest: "beach",
    });
    expect(negativePrompt).toContain("blurry");
    expect(negativePrompt).toContain(SAFETY_NEGATIVE);
  });
  it("is deterministic: same sheet + same request => same prompt", () => {
    const a = buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: "cafe" });
    const b = buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: "cafe" });
    expect(a.prompt).toBe(b.prompt);
    expect(a.negativePrompt).toBe(b.negativePrompt);
  });
  it("varies only by scene: two requests with same sheet share the trait/style prefix", () => {
    const a = buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: "cafe" });
    const b = buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: "beach" });
    const prefix = a.prompt.slice(0, a.prompt.indexOf("scene:"));
    expect(b.prompt.startsWith(prefix)).toBe(true);
  });
  // Phase 28: a creation-time image job (CreationImageJobPayload) sends
  // userRequest: "" (no chat-time free-text request exists yet). The
  // deterministic core prompt (stylePrompt + traits) must still build, with
  // no dangling "scene:" fragment for the empty request.
  it("creation-time jobs (empty userRequest) build the core prompt with no scene fragment", () => {
    const { prompt } = buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: "" });
    expect(prompt).toContain("cinematic portrait");
    expect(prompt).toContain("hair: auburn");
    expect(prompt).not.toContain("scene:");
  });
  it("all four creation variants share the same core prompt (deterministic, only scene differs)", () => {
    const variants = ["portrait", "candid", "outdoor", "studio"];
    const prompts = variants.map(
      (v) => buildImagePrompt({ appearanceSheet: SHEET, style: "realistic", userRequest: v }).prompt,
    );
    const prefix = prompts[0].slice(0, prompts[0].indexOf("scene:"));
    for (const p of prompts) {
      expect(p.startsWith(prefix)).toBe(true);
    }
  });
});

describe("buildImageCaption", () => {
  it("returns a bounded, non-empty caption", () => {
    const c = buildImageCaption("a selfie in Paris");
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(120);
  });
});

describe("shouldSendImage", () => {
  const base = {
    userRequested: false,
    tokenBalance: 100,
    imageCost: 20,
    recentImageCount: 0,
    recentImageLimit: 5,
  };
  it("blocks on insufficient tokens", () => {
    expect(shouldSendImage({ ...base, tokenBalance: 0 }).send).toBe(false);
  });
  it("sends on userRequested fast path", () => {
    expect(shouldSendImage({ ...base, userRequested: true }).send).toBe(true);
  });
  it("blocks when recent limit hit", () => {
    expect(shouldSendImage({ ...base, recentImageCount: 10 }).send).toBe(false);
  });
});

describe("safety", () => {
  it("rejects under-18 characters", () => {
    expect(() => assertCharacterAdult({ age: 17 })).toThrow(ImageSafetyError);
    expect(() => assertCharacterAdult({ age: 25 })).not.toThrow();
  });
  it("rejects minor-referencing prompts", () => {
    expect(() => rejectMinorReference("selfie of a schoolgirl")).toThrow(ImageSafetyError);
    expect(() => rejectMinorReference("selfie in a cafe")).not.toThrow();
  });
});
