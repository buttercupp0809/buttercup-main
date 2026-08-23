// InstantID identity conditioning (nodes 10,20,21,22,23) + KSampler (node 3) +
// VAEDecode (node 8). ipWeight is configurable so Fix 4 can lower it to 0.7-0.8.
// poseModelRef / posePositive / poseNegative let a pose-ControlNet block feed
// its model + conditioning in; when absent the base nodes (4,6,7) are used, which
// reproduces the current graph exactly.
export const INSTANTID_DEFAULTS = {
  ipWeight: 1.05,
  cnStrength: 0,
  endAt: 0.75,
  steps: 30,
  cfg: 4.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  instantidFile: "ip-adapter.bin",
  controlnetFile: "instantid_control.safetensors",
} as const;

export function instantIdNodes(a: {
  refName: string;
  seed: number;
  ipWeight?: number;
  modelRef?: [string, number];
  posePositive?: [string, number];
  poseNegative?: [string, number];
}): Record<string, unknown> {
  const ipWeight = a.ipWeight ?? INSTANTID_DEFAULTS.ipWeight;
  return {
    "10": { class_type: "LoadImage", inputs: { image: a.refName } },
    "20": { class_type: "InstantIDModelLoader", inputs: { instantid_file: INSTANTID_DEFAULTS.instantidFile } },
    "21": { class_type: "InstantIDFaceAnalysis", inputs: { provider: "CPU" } },
    "22": { class_type: "ControlNetLoader", inputs: { control_net_name: INSTANTID_DEFAULTS.controlnetFile } },
    "23": {
      class_type: "ApplyInstantIDAdvanced",
      inputs: {
        instantid: ["20", 0],
        insightface: ["21", 0],
        control_net: ["22", 0],
        image: ["10", 0],
        model: a.modelRef ?? ["4", 0],
        positive: a.posePositive ?? ["6", 0],
        negative: a.poseNegative ?? ["7", 0],
        ip_weight: ipWeight,
        cn_strength: INSTANTID_DEFAULTS.cnStrength,
        start_at: 0.0,
        end_at: INSTANTID_DEFAULTS.endAt,
        noise: 0.0,
        combine_embeds: "average",
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: a.seed,
        steps: INSTANTID_DEFAULTS.steps,
        cfg: INSTANTID_DEFAULTS.cfg,
        sampler_name: INSTANTID_DEFAULTS.sampler,
        scheduler: INSTANTID_DEFAULTS.scheduler,
        denoise: 1,
        model: ["23", 0],
        positive: ["23", 1],
        negative: ["23", 2],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  };
}
