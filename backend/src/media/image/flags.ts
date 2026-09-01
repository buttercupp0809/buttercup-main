// A/B flags for the staged image-quality rollout. Every flag defaults OFF so
// the pipeline is byte-identical to today until a flag is deliberately enabled.
export interface ImageWorkflowFlags {
  faceDetailer: boolean;
  handDetailer: boolean;
  poseControlNet: boolean;
  yawGate: boolean;
  pulid: boolean;
  lora: boolean;
  upscaleTail: boolean;
}

function envOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

export function resolveImageFlags(override?: Partial<ImageWorkflowFlags>): ImageWorkflowFlags {
  const fromEnv: ImageWorkflowFlags = {
    faceDetailer: envOn("IMG_FACEDETAILER"),
    handDetailer: envOn("IMG_HAND_DETAILER"),
    poseControlNet: envOn("IMG_POSE_CONTROLNET"),
    yawGate: envOn("IMG_YAW_GATE"),
    pulid: envOn("IMG_PULID"),
    lora: envOn("IMG_LORA"),
    upscaleTail: envOn("IMG_UPSCALE_TAIL"),
  };
  return { ...fromEnv, ...(override ?? {}) };
}
