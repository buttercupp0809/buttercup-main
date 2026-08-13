// Image-generation constants. Model + size selection per style is
// centralized so a provider swap does not leak into the prompt builder.
// SAFETY_NEGATIVE is the mandatory 18+ guard appended to every request.

export const SAFETY_NEGATIVE =
  "child, kid, minor, underage, teen, preteen, schoolgirl, schoolboy, young girl, young boy, loli, shota, cub, prepubescent";

export const IMAGE_SIZE = {
  realistic: { width: 768, height: 1344 }, // 9:16 portrait for full-body shots
  "3d": { width: 1024, height: 1024 },
  anime: { width: 832, height: 1216 },
} as const;

export const FAL_MODELS = {
  realistic: "fal-ai/flux/dev",
  "3d": "fal-ai/flux/dev",
  anime: "fal-ai/flux/schnell",
} as const;

export const REPLICATE_MODELS = {
  realistic: "stability-ai/sdxl",
  "3d": "stability-ai/sdxl",
  anime: "cjwbw/anything-v4.5",
} as const;

// Self-hosted Juggernaut XL (photorealistic SDXL) served via ComfyUI.
// DPM++ 2M Karras at CFG 7 gives sharp, realistic results.
// Override the checkpoint filename with POPPY_JUGGERNAUT_CHECKPOINT if it differs.
export const COMFY = {
  checkpoint: "juggernautXL_v9.safetensors",
  steps: 35,
  cfg: 7,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  qualityPrefix: "full body from head to toe, entire figure visible including feet, full length wide shot, whole body inside the frame, standing far from camera, RAW photo, photorealistic, masterpiece, best quality, 8k uhd, dslr, sharp focus, high detail, ",
  pollMs: 2000,
  maxPolls: 150,
} as const;
