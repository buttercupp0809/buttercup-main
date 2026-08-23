import { describe, it, expect } from "vitest";
import { secondsToFrames, framesToSeconds, clampSeconds } from "./frames";

describe("wan frame math", () => {
  it("maps 5s at 16fps to 81 frames (4n+1)", () => {
    expect(secondsToFrames(5, 16)).toBe(81);
  });
  it("always returns a 4n+1 frame count", () => {
    for (let s = 1; s <= 10; s++) {
      const f = secondsToFrames(s, 16);
      expect((f - 1) % 4).toBe(0);
    }
  });
  it("framesToSeconds inverts within one frame (81f@16fps = 5.0625s)", () => {
    expect(framesToSeconds(81, 16)).toBeCloseTo(5, 0); // within 0.5s of 5
  });
  it("clampSeconds bounds to [1,10]", () => {
    expect(clampSeconds(0)).toBe(1);
    expect(clampSeconds(99)).toBe(10);
    expect(clampSeconds(5)).toBe(5);
  });
});
