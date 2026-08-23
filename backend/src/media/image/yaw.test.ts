import { describe, it, expect } from "vitest";
import { estimateYawFromPoseHint } from "./yaw";

describe("estimateYawFromPoseHint", () => {
  it("frontal descriptors are ~0 deg", () => {
    expect(estimateYawFromPoseHint("looking directly at camera")).toBeLessThan(15);
  });
  it("three-quarter and over-shoulder exceed the 30 deg gate", () => {
    expect(estimateYawFromPoseHint("three-quarter view turning right")).toBeGreaterThanOrEqual(30);
    expect(estimateYawFromPoseHint("glancing over shoulder")).toBeGreaterThanOrEqual(30);
  });
});
