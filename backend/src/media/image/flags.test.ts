import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveImageFlags } from "./flags";

const IMG_FLAG_ENV = ["IMG_FACEDETAILER", "IMG_HAND_DETAILER", "IMG_POSE_CONTROLNET", "IMG_YAW_GATE", "IMG_PULID"];

describe("resolveImageFlags", () => {
  // vitest.setup.ts loads backend/.env, which may set operational flags (e.g.
  // IMG_FACEDETAILER=1). Clear them so these tests assert true defaults.
  beforeEach(() => {
    for (const k of IMG_FLAG_ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of IMG_FLAG_ENV) delete process.env[k];
  });

  it("defaults every flag OFF", () => {
    expect(resolveImageFlags()).toEqual({
      faceDetailer: false,
      handDetailer: false,
      poseControlNet: false,
      yawGate: false,
      pulid: false,
    });
  });

  it("reads env truthy values", () => {
    process.env.IMG_FACEDETAILER = "1";
    expect(resolveImageFlags().faceDetailer).toBe(true);
  });

  it("per-request override beats env", () => {
    process.env.IMG_FACEDETAILER = "1";
    expect(resolveImageFlags({ faceDetailer: false }).faceDetailer).toBe(false);
  });
});
