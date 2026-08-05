import { describe, expect, it } from "vitest";
import { buildImagePrompt, buildImageCaption } from "./prompt";
import { isImageRequest, shouldSendImage } from "./decision";
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
});

describe("buildImageCaption", () => {
  it("returns a bounded, non-empty caption", () => {
    const c = buildImageCaption("a selfie in Paris");
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(120);
  });
});

describe("isImageRequest", () => {
  it("matches typical selfie requests", () => {
    expect(isImageRequest("send me a selfie please")).toBe(true);
    expect(isImageRequest("can I see you?")).toBe(true);
    expect(isImageRequest("show me a pic")).toBe(true);
  });
  it("does not match plain chat", () => {
    expect(isImageRequest("hi there")).toBe(false);
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
