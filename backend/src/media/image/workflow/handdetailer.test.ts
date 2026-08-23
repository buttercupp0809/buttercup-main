import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

describe("Hand detailer flag", () => {
  it("adds a hand detailer and runs it last (SaveImage consumes it)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true, handDetailer: true }) });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("DetailerForEach");
    const hdId = Object.keys(g).find((k) => (g[k] as { class_type: string }).class_type === "DetailerForEach")!;
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images[0]).toBe(hdId);
  });

  it("uses a hand model, not a face model", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ handDetailer: true }) });
    const provider = Object.values(g).find(
      (n) => (n as { inputs?: { model_name?: string } }).inputs?.model_name?.includes("hand"),
    ) as { inputs: { model_name: string } };
    expect(provider.inputs.model_name).toMatch(/hand/);
  });

  it("matches the box signature (prefixed model + BboxDetectorSEGS drop_size/labels + DetailerForEach wildcard)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ handDetailer: true }) });
    const provider = Object.values(g).find(
      (n) => (n as { class_type: string }).class_type === "UltralyticsDetectorProvider",
    ) as { inputs: { model_name: string } };
    expect(provider.inputs.model_name).toMatch(/^bbox\//);
    const segs = Object.values(g).find((n) => (n as { class_type: string }).class_type === "BboxDetectorSEGS") as {
      inputs: Record<string, unknown>;
    };
    expect(segs.inputs).toHaveProperty("drop_size");
    expect(segs.inputs).toHaveProperty("labels");
    const det = Object.values(g).find((n) => (n as { class_type: string }).class_type === "DetailerForEach") as {
      inputs: Record<string, unknown>;
    };
    expect(det.inputs).toHaveProperty("wildcard");
  });
});
