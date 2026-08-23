import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

describe("Pose ControlNet flag", () => {
  it("adds an OpenPose ControlNet apply and strips the head (show_face=false)", () => {
    const g = assembleConsistentWorkflow({
      ...base,
      flags: resolveImageFlags({ poseControlNet: true }),
      poseSkeletonName: "pose-sitting.png",
    });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.some((c) => c.includes("ControlNetApply"))).toBe(true);
    const editor = Object.values(g).find((n) => (n as { class_type: string }).class_type.includes("OpenposeEditor")) as {
      inputs: { show_face: boolean };
    };
    expect(editor.inputs.show_face).toBe(false);
  });

  it("lowers InstantID ip_weight to 0.75 when pose control is on", () => {
    const g = assembleConsistentWorkflow({
      ...base,
      flags: resolveImageFlags({ poseControlNet: true }),
      poseSkeletonName: "pose-sitting.png",
    });
    expect((g["23"] as { inputs: { ip_weight: number } }).inputs.ip_weight).toBe(0.75);
  });

  it("falls back (no pose block, ip_weight unchanged) when no skeleton matched", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ poseControlNet: true }) });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.some((c) => c.includes("ControlNetApply"))).toBe(false);
    expect((g["23"] as { inputs: { ip_weight: number } }).inputs.ip_weight).toBe(1.05);
  });
});
