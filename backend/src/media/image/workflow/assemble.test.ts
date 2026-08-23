import { describe, it, expect, beforeEach } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "juggernautXL_v9.safetensors", positive: "p", negative: "n", refName: "chat-ref.png", seed: 1 };

// vitest.setup.ts loads backend/.env, which may enable flags operationally.
// Clear them so resolveImageFlags() reflects true defaults in these tests.
beforeEach(() => {
  for (const k of ["IMG_FACEDETAILER", "IMG_HAND_DETAILER", "IMG_POSE_CONTROLNET", "IMG_YAW_GATE", "IMG_PULID"]) {
    delete process.env[k];
  }
});

describe("assembleConsistentWorkflow (all flags off = current graph)", () => {
  it("produces exactly the current node ids", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    expect(Object.keys(g).sort()).toEqual(
      ["10", "20", "21", "22", "23", "3", "4", "5", "6", "7", "8", "9", "50"].sort(),
    );
    expect((g["23"] as { inputs: { ip_weight: number } }).inputs.ip_weight).toBe(1.05);
    expect((g["23"] as { inputs: { cn_strength: number } }).inputs.cn_strength).toBe(0);
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
    // SaveImage still consumes the faceswap output when no detailers are on.
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["50", 0]);
  });

  it("does not add a gpen_visibility input in the default (all-off) graph", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    expect((g["50"] as { inputs: Record<string, unknown> }).inputs.gpen_visibility).toBeUndefined();
  });

  it("skipFaceSwap drops the PoppyFaceSwap node (video restyle path)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags(), skipFaceSwap: true });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).not.toContain("PoppyFaceSwap");
    expect(g["50"]).toBeUndefined();
    // With no swap and no detailers, SaveImage consumes the InstantID VAEDecode (node 8).
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["8", 0]);
  });

  it("keeps the faceswap by default (chat images unchanged when skipFaceSwap is not set)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
  });

  it("falls back to the current graph when a capability is marked unavailable", () => {
    const g = assembleConsistentWorkflow({
      ...base,
      flags: resolveImageFlags({ faceDetailer: true, handDetailer: true }),
      availableNodes: new Set<string>(), // nothing available -> no detailers added
    });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).not.toContain("FaceDetailer");
    expect(classes).not.toContain("DetailerForEach");
    // GPEN visibility is not dropped when FaceDetailer could not be added.
    expect((g["50"] as { inputs: Record<string, unknown> }).inputs.gpen_visibility).toBeUndefined();
  });
});
