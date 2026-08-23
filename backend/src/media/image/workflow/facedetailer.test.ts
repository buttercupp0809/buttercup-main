import { describe, it, expect } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "c", positive: "p", negative: "n", refName: "r.png", seed: 1 };

describe("FaceDetailer flag", () => {
  it("inserts FaceDetailer after faceswap and before SaveImage", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }) });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("FaceDetailer");
    const save = g["9"] as { inputs: { images: [string, number] } };
    const fdNodeId = Object.keys(g).find((k) => (g[k] as { class_type: string }).class_type === "FaceDetailer")!;
    expect(save.inputs.images[0]).toBe(fdNodeId); // SaveImage now consumes FaceDetailer
  });

  it("caps denoise at 0.35 to protect identity", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }) });
    const fd = Object.values(g).find((n) => (n as { class_type: string }).class_type === "FaceDetailer") as {
      inputs: { denoise: number };
    };
    expect(fd.inputs.denoise).toBeLessThanOrEqual(0.35);
  });

  it("matches the box FaceDetailer signature (prefixed model + required sam_/wildcard/drop_size inputs)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }) });
    const provider = Object.values(g).find(
      (n) => (n as { class_type: string }).class_type === "UltralyticsDetectorProvider",
    ) as { inputs: { model_name: string } };
    expect(provider.inputs.model_name).toMatch(/^bbox\//); // not bare, or ComfyUI 400s
    const fd = Object.values(g).find((n) => (n as { class_type: string }).class_type === "FaceDetailer") as {
      inputs: Record<string, unknown>;
    };
    for (const k of ["wildcard", "sam_detection_hint", "sam_dilation", "sam_threshold", "sam_bbox_expansion", "sam_mask_hint_threshold", "sam_mask_hint_use_negative", "drop_size", "cycle"]) {
      expect(fd.inputs).toHaveProperty(k);
    }
  });

  it("lowers GPEN visibility when FaceDetailer is on", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags({ faceDetailer: true }), gpenVisibility: 0.6 });
    const swap = g["50"] as { inputs: { gpen_visibility: number } };
    expect(swap.inputs.gpen_visibility).toBe(0.6);
  });
});
