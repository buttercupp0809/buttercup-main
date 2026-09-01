import { describe, it, expect, beforeEach } from "vitest";
import { assembleConsistentWorkflow } from "./assemble";
import { resolveImageFlags } from "../flags";

const base = { ckpt: "juggernautXL_v9.safetensors", positive: "p", negative: "n", refName: "chat-ref.png", seed: 1 };

// vitest.setup.ts loads backend/.env, which may enable flags operationally.
// Clear them so resolveImageFlags() reflects true defaults in these tests.
beforeEach(() => {
  for (const k of ["IMG_FACEDETAILER", "IMG_HAND_DETAILER", "IMG_POSE_CONTROLNET", "IMG_YAW_GATE", "IMG_PULID", "IMG_LORA", "IMG_UPSCALE_TAIL"]) {
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

  it("refineBlend keeps the exact-face swap AND appends a low-denoise full-frame refiner", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags(), refineBlend: true });
    // The exact-face swap is still present.
    expect((g["50"] as { class_type: string }).class_type).toBe("PoppyFaceSwap");
    // Refiner chain: VAEEncode -> KSampler (low denoise) -> VAEDecode.
    expect((g["100"] as { class_type: string }).class_type).toBe("VAEEncode");
    expect((g["101"] as { class_type: string }).class_type).toBe("KSampler");
    expect((g["101"] as { inputs: { denoise: number } }).inputs.denoise).toBe(0.25);
    expect((g["102"] as { class_type: string }).class_type).toBe("VAEDecode");
    // SaveImage consumes the refiner output, not the raw swap.
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["102", 0]);
  });

  it("refineDenoise overrides the default blend strength", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags(), refineBlend: true, refineDenoise: 0.4 });
    expect((g["101"] as { inputs: { denoise: number } }).inputs.denoise).toBe(0.4);
  });

  it("no refiner nodes when refineBlend is off (chat images unchanged)", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    expect(g["100"]).toBeUndefined();
    expect(g["101"]).toBeUndefined();
    expect(g["102"]).toBeUndefined();
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

  it("is byte-identical when the lora flag is off (regression guard)", () => {
    const off = assembleConsistentWorkflow({
      ckpt: "juggernautXL_v9.safetensors", positive: "p", negative: "n",
      refName: "r.png", seed: 1, flags: resolveImageFlags(),
    });
    expect(off["30"]).toBeUndefined();
    expect((off["6"] as any).inputs.clip).toEqual(["4", 1]);
  });

  it("inserts LoRA node 30, reroutes clip, lowers ipWeight when lora on", () => {
    const on = assembleConsistentWorkflow({
      ckpt: "realvisxlV50.safetensors", positive: "ch_abc woman", negative: "n",
      refName: "r.png", seed: 1, flags: resolveImageFlags({ lora: true }),
      loraName: "ch_abc.safetensors",
      availableNodes: new Set(["LoraLoader", "ApplyInstantIDAdvanced"]),
    });
    expect((on["30"] as any).class_type).toBe("LoraLoader");
    expect((on["6"] as any).inputs.clip).toEqual(["30", 1]);
    expect((on["23"] as any).inputs.model).toEqual(["30", 0]);
    expect((on["23"] as any).inputs.ip_weight).toBe(0.6);
  });

  it("byte-identical when upscaleTail is off: node 110 absent and lastImage unchanged", () => {
    const g = assembleConsistentWorkflow({ ...base, flags: resolveImageFlags() });
    // Node 110 (VAEEncode for upscale) must be absent when upscaleTail is off.
    expect(g["110"]).toBeUndefined();
    expect(g["111"]).toBeUndefined();
    expect(g["112"]).toBeUndefined();
    expect(g["113"]).toBeUndefined();
    // SaveImage still consumes faceswap output (lastImage unchanged).
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["50", 0]);
  });

  it("adds upscale nodes 110-113 and advances SaveImage when upscaleTail on", () => {
    const g = assembleConsistentWorkflow({
      ...base, flags: resolveImageFlags({ upscaleTail: true }),
      availableNodes: new Set(["LatentUpscaleBy"]),
    });
    expect((g["110"] as any).class_type).toBe("VAEEncode");
    expect((g["113"] as any).class_type).toBe("LatentUpscaleBy");
    expect((g["111"] as any).class_type).toBe("KSampler");
    expect((g["111"] as any).inputs.denoise).toBeLessThanOrEqual(0.35);
    expect((g["112"] as any).class_type).toBe("VAEDecode");
    // SaveImage now consumes the upscale VAEDecode output.
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["112", 0]);
  });

  it("skips upscale block when LatentUpscaleBy not in availableNodes", () => {
    const g = assembleConsistentWorkflow({
      ...base, flags: resolveImageFlags({ upscaleTail: true }),
      availableNodes: new Set<string>(), // empty: LatentUpscaleBy unavailable
    });
    expect(g["110"]).toBeUndefined();
    // SaveImage still consumes faceswap output (no upscale).
    expect((g["9"] as { inputs: { images: [string, number] } }).inputs.images).toEqual(["50", 0]);
  });
});
