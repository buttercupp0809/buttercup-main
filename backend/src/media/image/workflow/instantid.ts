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
  // ip_weight used when a per-character LoRA is also active, lowered so InstantID
  // does not fight the LoRA's identity conditioning. (Was a bare 0.6 in assemble.)
  ipWeightWithLora: 0.6,
  // On full-body / pose shots InstantID's keypoint ControlNet is given a small
  // non-zero strength so the face persists through the pose change (identity
  // drift is worst on full-body). Tune via A/B: higher = stiffer face-lock,
  // lower = more pose freedom. Applies ONLY on the pose branch; the default
  // (no-pose) graph keeps cn_strength at 0 and stays byte-identical.
  cnStrengthFullBody: 0.25,
} as const;

export function instantIdNodes(a: {
  refName: string;
  seed: number;
  ipWeight?: number;
  // Override InstantID's keypoint ControlNet strength (default 0). Used by the
  // pose branch to raise identity persistence on full-body shots.
  cnStrength?: number;
  modelRef?: [string, number];
  posePositive?: [string, number];
  poseNegative?: [string, number];
}): Record<string, unknown> {
  const ipWeight = a.ipWeight ?? INSTANTID_DEFAULTS.ipWeight;
  const cnStrength = a.cnStrength ?? INSTANTID_DEFAULTS.cnStrength;
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
        cn_strength: cnStrength,
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
