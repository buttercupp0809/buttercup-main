// Image-generation constants. Model + size selection per style is
// centralized so a provider swap does not leak into the prompt builder.
// SAFETY_NEGATIVE is the mandatory 18+ guard appended to every request.

export const SAFETY_NEGATIVE =
  "child, kid, minor, underage, teen, preteen, schoolgirl, schoolboy, young girl, young boy, loli, shota, cub, prepubescent";

export const IMAGE_SIZE = {
  realistic: { width: 1024, height: 1024 },
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
