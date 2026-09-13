import { describe, it, expect } from "vitest";
import { upscaleNodes } from "./upscale";

describe("upscaleNodes", () => {
  it("adds a 2x latent upscale + low-denoise refine and returns the decode id", () => {
    const r = upscaleNodes({
      inputImage: ["50", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 7,
    });
    expect(r.outId).toBe("112");
    const k = r.nodes["111"] as any;
    expect(k.class_type).toBe("KSampler");
    expect(k.inputs.denoise).toBeLessThanOrEqual(0.35);
  });

  it("uses the provided model ref when given", () => {
    const r = upscaleNodes({
      inputImage: ["82", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 42, model: ["30", 0],
    });
    const k = r.nodes["111"] as any;
    expect(k.inputs.model).toEqual(["30", 0]);
  });

  it("falls back to checkpoint model when model is not provided", () => {
    const r = upscaleNodes({
      inputImage: ["50", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 1,
    });
    const k = r.nodes["111"] as any;
    expect(k.inputs.model).toEqual(["4", 0]);
  });

  it("node 110 is VAEEncode and node 113 is LatentUpscaleBy with scale_by 2", () => {
    const r = upscaleNodes({
      inputImage: ["50", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 3,
    });
    expect((r.nodes["110"] as any).class_type).toBe("VAEEncode");
    expect((r.nodes["113"] as any).class_type).toBe("LatentUpscaleBy");
    expect((r.nodes["113"] as any).inputs.scale_by).toBe(2);
  });

  it("node 112 is VAEDecode (the outId node)", () => {
    const r = upscaleNodes({
      inputImage: ["50", 0], positive: ["6", 0], negative: ["7", 0],
      vae: ["4", 2], seed: 5,
    });
    expect((r.nodes["112"] as any).class_type).toBe("VAEDecode");
  });
});
