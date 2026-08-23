import { describe, it, expect } from "vitest";
import { buildWanWorkflow } from "./workflow";

const base = {
  positive: "a woman waving",
  negative: "blurry",
  aspect: "portrait" as const,
  seconds: 5,
  seed: 42,
};

// Helper: find the KSamplerAdvanced whose start_at_step is 0 (the high-noise
// expert) vs the one that starts later (the low-noise expert).
function samplers(g: Record<string, unknown>) {
  const all = Object.values(g).filter(
    (n): n is { class_type: string; inputs: Record<string, unknown> } =>
      (n as { class_type: string }).class_type === "KSamplerAdvanced",
  );
  const high = all.find((n) => n.inputs.start_at_step === 0);
  const low = all.find((n) => (n.inputs.start_at_step as number) > 0);
  return { all, high, low };
}

describe("buildWanWorkflow", () => {
  it("fast uses two samplers, no image loader, LoRAs on both experts", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "fast", interpolate: false });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.filter((c) => c === "KSamplerAdvanced")).toHaveLength(2);
    expect(classes).not.toContain("LoadImage");
    expect(classes.filter((c) => c === "LoraLoaderModelOnly")).toHaveLength(2);
  });

  it("i2v requires and wires a reference image", () => {
    const g = buildWanWorkflow({ ...base, mode: "i2v", preset: "fast", refImageName: "ref.png", interpolate: false });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes).toContain("LoadImage");
  });

  it("i2v without a reference image throws", () => {
    expect(() => buildWanWorkflow({ ...base, mode: "i2v", preset: "fast", interpolate: false })).toThrow();
  });

  it("max preset applies no Lightning LoRAs", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "max", interpolate: true });
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.filter((c) => c === "LoraLoaderModelOnly")).toHaveLength(0);
  });

  it("balanced weakens the high-expert LoRA to 0.7 (cfg 3.5), keeps the low LoRA full at cfg 1.0", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "balanced", interpolate: true });
    const { all, high, low } = samplers(g);
    expect(all).toHaveLength(2);
    expect(high?.inputs.cfg).toBe(3.5);
    expect(low?.inputs.cfg).toBe(1.0);
    // Both LoRA nodes exist: high (30) at 0.7 strength, low (31) at 1.0.
    const classes = Object.values(g).map((n) => (n as { class_type: string }).class_type);
    expect(classes.filter((c) => c === "LoraLoaderModelOnly")).toHaveLength(2);
    const highLora = g["30"] as { inputs: { strength_model: number } };
    expect(highLora.inputs.strength_model).toBe(0.7);
    const lowLora = g["31"] as { inputs: { strength_model: number } };
    expect(lowLora.inputs.strength_model).toBe(1.0);
    // Each expert's ModelSamplingSD3 feeds off its own LoRA node.
    const highSampling = g["50"] as { inputs: { model: [string, number] } };
    expect(highSampling.inputs.model).toEqual(["30", 0]);
    const lowSampling = g["52"] as { inputs: { model: [string, number] } };
    expect(lowSampling.inputs.model).toEqual(["31", 0]);
  });

  it("uses per-expert step boundaries (start/end)", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "balanced", interpolate: true });
    const { high, low } = samplers(g);
    // balanced: high 4 steps, low 4 steps, total 8.
    expect(high?.inputs.start_at_step).toBe(0);
    expect(high?.inputs.end_at_step).toBe(4);
    expect(high?.inputs.steps).toBe(8);
    expect(low?.inputs.start_at_step).toBe(4);
    expect(low?.inputs.end_at_step).toBe(8);
    expect(low?.inputs.steps).toBe(8);
  });

  it("maps aspect to width/height (landscape swaps dims)", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "fast", aspect: "landscape", interpolate: false });
    const latent = g["41"] as { inputs: { width: number; height: number } };
    expect(latent.inputs.width).toBe(832);
    expect(latent.inputs.height).toBe(480);
  });

  it("keeps the SaveWEBM crf input", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "fast", interpolate: false });
    const save = g["61"] as { class_type: string; inputs: { crf: number } };
    expect(save.class_type).toBe("SaveWEBM");
    expect(save.inputs.crf).toBe(19);
  });

  it("snaps a 5s clip to 81 frames on the latent source", () => {
    const g = buildWanWorkflow({ ...base, mode: "t2v", preset: "fast", interpolate: false });
    const latent = g["41"] as { inputs: { length: number } };
    expect(latent.inputs.length).toBe(81);
  });

  // Task 3: RIFE VFI node + HQ resolution tests.
  it("inserts RIFE and saves at 32fps when interpolate is true", () => {
    const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "balanced", refImageName: "r.png", interpolate: true }) as Record<string, any>;
    const rife = Object.values(g).find((n: any) => n.class_type === "RIFE VFI") as any;
    expect(rife).toBeTruthy();
    expect(rife.inputs.frames).toEqual(["60", 0]);
    expect(rife.inputs.ckpt_name).toBe("rife49.pth");
    expect(rife.inputs.multiplier).toBe(2);
    const save = Object.values(g).find((n: any) => n.class_type === "SaveWEBM") as any;
    expect(save.inputs.fps).toBe(32);
    // SaveWEBM reads from the RIFE node, not the decoder.
    const rifeId = Object.keys(g).find((k) => g[k].class_type === "RIFE VFI");
    expect(save.inputs.images[0]).toBe(rifeId);
  });

  it("no RIFE and 16fps when interpolate is false (fast)", () => {
    const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "fast", refImageName: "r.png", interpolate: false }) as Record<string, any>;
    expect(Object.values(g).some((n: any) => n.class_type === "RIFE VFI")).toBe(false);
    const save = Object.values(g).find((n: any) => n.class_type === "SaveWEBM") as any;
    expect(save.inputs.fps).toBe(16);
    expect(save.inputs.images).toEqual(["60", 0]);
  });

  it("uses 720p HQ dims for the hq preset (max)", () => {
    const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "max", refImageName: "r.png", interpolate: true }) as Record<string, any>;
    const i2v = Object.values(g).find((n: any) => n.class_type === "WanImageToVideo") as any;
    expect(i2v.inputs.width).toBe(720);
    expect(i2v.inputs.height).toBe(1280);
  });

  it("keeps balanced at the lighter 480p dims (fast render, no OOM/stall)", () => {
    const g = buildWanWorkflow({ mode: "i2v", positive: "p", negative: "n", aspect: "portrait", seconds: 5, seed: 1, preset: "balanced", refImageName: "r.png", interpolate: true }) as Record<string, any>;
    const i2v = Object.values(g).find((n: any) => n.class_type === "WanImageToVideo") as any;
    expect(i2v.inputs.width).toBe(480);
    expect(i2v.inputs.height).toBe(832);
    // balanced weakens the high-expert LoRA rather than removing it: a LoRA node exists.
    const loras = Object.values(g).filter((n: any) => n.class_type === "LoraLoaderModelOnly") as any[];
    expect(loras.length).toBe(2);
  });
});
