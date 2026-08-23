import { describe, it, expect, beforeEach } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

// backend/.env (loaded by vitest.setup.ts) may enable flags; clear for defaults.
beforeEach(() => {
  for (const k of ["IMG_FACEDETAILER", "IMG_HAND_DETAILER", "IMG_POSE_CONTROLNET", "IMG_YAW_GATE", "IMG_PULID"]) {
    delete process.env[k];
  }
});

describe("yaw gate + PuLID", () => {
  it("skips faceswap when yaw >= 30 and gate on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ yawGate: true }), yawDeg: 40 });
    expect(g["50"]).toBeUndefined(); // no PoppyFaceSwap
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["8", 0]);
  });

  it("keeps faceswap when yaw < 30 even with gate on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ yawGate: true }), yawDeg: 10 });
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
  });

  it("inserts PuLID conditioning when pulid flag on and yaw high", () => {
    const g = assembleConsistentWorkflow({
      ...base,
      flags: resolveImageFlags({ yawGate: true, pulid: true }),
      yawDeg: 40,
    });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    // cubiq/PuLID_ComfyUI class names are "Pulid*" / "ApplyPulid".
    expect(classes.some((c) => c.includes("Pulid"))).toBe(true);
    // The KSampler model source is the PuLID output, not the base checkpoint.
    expect((g["23"] as { inputs: { model: [string, number] } }).inputs.model).toEqual(["63", 0]);
  });
});
