// Skin/texture upscale tail. Encodes the finished image to latent, upscales 2x,
// and runs a LOW-denoise KSampler so pores/texture appear without changing
// identity or composition. Runs last (after face + hand detailers).
export const UPSCALE_DEFAULTS = { factor: 2, denoise: 0.3, steps: 18, cfg: 5 } as const;

export function upscaleNodes(a: {
  inputImage: [string, number];
  positive: [string, number];
  negative: [string, number];
  vae: [string, number];
  model?: [string, number];
  seed: number;
}): { nodes: Record<string, unknown>; outId: string } {
  const model = a.model ?? (["4", 0] as [string, number]);
  return {
    nodes: {
      "110": { class_type: "VAEEncode", inputs: { pixels: a.inputImage, vae: a.vae } },
      "113": {
        class_type: "LatentUpscaleBy",
        inputs: { samples: ["110", 0], upscale_method: "nearest-exact", scale_by: UPSCALE_DEFAULTS.factor },
      },
      "111": {
        class_type: "KSampler",
        inputs: {
          model, positive: a.positive, negative: a.negative, latent_image: ["113", 0],
          seed: a.seed, steps: UPSCALE_DEFAULTS.steps, cfg: UPSCALE_DEFAULTS.cfg,
          sampler_name: "dpmpp_2m", scheduler: "karras", denoise: UPSCALE_DEFAULTS.denoise,
        },
      },
      "112": { class_type: "VAEDecode", inputs: { samples: ["111", 0], vae: a.vae } },
    },
    outId: "112",
  };
}
