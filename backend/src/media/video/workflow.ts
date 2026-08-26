// Build the ComfyUI graph for Wan 2.2 A14B. The A14B model is a two-expert MoE:
// the high-noise expert denoises the early steps, then hands the latent to the
// low-noise expert for the late steps. Lightning (LightX2V distill LoRAs) cut the
// step count and set cfg 1.0; the full preset skips the LoRAs. Pure function, no
// I/O; the caller uploads any reference frame and downloads the result.
//
// NOTE: exact Wan node class_type names (WanImageToVideo, Wan22ImageToVideoLatent,
// SaveWEBM) must be confirmed against the ComfyUI build on the box at bring-up;
// if one differs, update it here and re-run this file's tests (they assert graph
// structure, not the box).

import {
  WAN_STEPS,
  WAN_SHIFT,
  WAN_FPS,
  VIDEO_ASPECTS,
  VIDEO_ASPECTS_HQ,
  RIFE_CKPT,
  RIFE_MULTIPLIER,
  interpolatedFps,
  type VideoAspect,
  type WanPreset,
} from "./constants";
import { secondsToFrames } from "./frames";

// Model file names on the box (overridable via env; see Plans/inference-video-aws).
const MODELS = {
  t2vHigh: process.env.WAN_T2V_HIGH ?? "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
  t2vLow: process.env.WAN_T2V_LOW ?? "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
  i2vHigh: process.env.WAN_I2V_HIGH ?? "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  i2vLow: process.env.WAN_I2V_LOW ?? "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  vae: process.env.WAN_VAE ?? "wan_2.1_vae.safetensors",
  clip: process.env.WAN_CLIP ?? "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  loraHigh: process.env.WAN_LORA_HIGH ?? "wan2.2_lightning_i2v_high.safetensors",
  loraLow: process.env.WAN_LORA_LOW ?? "wan2.2_lightning_i2v_low.safetensors",
} as const;

export interface WanWorkflowArgs {
  mode: "t2v" | "i2v";
  positive: string;
  negative: string;
  aspect: VideoAspect;
  seconds: number;
  seed: number;
  preset: WanPreset;
  refImageName?: string; // required when mode === "i2v"
  interpolate?: boolean; // caller passes WAN_STEPS[preset].interpolate && videoInterpolationEnabled(); defaults false
}

export function buildWanWorkflow(a: WanWorkflowArgs): Record<string, unknown> {
  if (a.mode === "i2v" && !a.refImageName) throw new Error("i2v_requires_reference");
  const interpolate = a.interpolate ?? false;
  const size = WAN_STEPS[a.preset].hq ? VIDEO_ASPECTS_HQ[a.aspect] : VIDEO_ASPECTS[a.aspect];
  const frames = secondsToFrames(a.seconds, WAN_FPS);
  const highModel = a.mode === "t2v" ? MODELS.t2vHigh : MODELS.i2vHigh;
  const lowModel = a.mode === "t2v" ? MODELS.t2vLow : MODELS.i2vLow;
  const preset = WAN_STEPS[a.preset];
  // The step boundary is the number of high-noise steps; the low-noise expert
  // runs the remaining steps.high..total window.
  const totalSteps = preset.high.steps + preset.low.steps;

  const g: Record<string, unknown> = {};

  // Text encoder + prompts + VAE.
  g["10"] = { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "wan" } };
  g["11"] = { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: ["10", 0] } };
  g["12"] = { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: ["10", 0] } };
  g["13"] = { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } };

  // High + low expert model loaders.
  g["20"] = { class_type: "UNETLoader", inputs: { unet_name: highModel, weight_dtype: "fp8_e4m3fn" } };
  g["21"] = { class_type: "UNETLoader", inputs: { unet_name: lowModel, weight_dtype: "fp8_e4m3fn" } };

  // Optional Lightning LoRAs applied per expert. Each expert gets the LoRA only
  // when its preset entry sets `loraStrength > 0`, applied at that strength
  // (fast: both at 1.0; balanced: low at 1.0, high weakened to 0.7 for motion;
  // max: neither).
  let highModelRef: [string, number] = ["20", 0];
  let lowModelRef: [string, number] = ["21", 0];
  if (preset.high.loraStrength > 0) {
    g["30"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["20", 0], lora_name: MODELS.loraHigh, strength_model: preset.high.loraStrength },
    };
    highModelRef = ["30", 0];
  }
  if (preset.low.loraStrength > 0) {
    g["31"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["21", 0], lora_name: MODELS.loraLow, strength_model: preset.low.loraStrength },
    };
    lowModelRef = ["31", 0];
  }

  // Latent source: T2V from an empty video latent, I2V from a reference frame.
  if (a.mode === "i2v") {
    g["40"] = { class_type: "LoadImage", inputs: { image: a.refImageName } };
    g["41"] = {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["11", 0],
        negative: ["12", 0],
        vae: ["13", 0],
        width: size.width,
        height: size.height,
        length: frames,
        batch_size: 1,
        start_image: ["40", 0],
      },
    };
  } else {
    g["41"] = {
      class_type: "Wan22ImageToVideoLatent",
      inputs: { width: size.width, height: size.height, length: frames, batch_size: 1, vae: ["13", 0] },
    };
  }
  // I2V node 41 re-emits conditioning + latent; T2V routes raw text conditioning.
  const posCond: [string, number] = a.mode === "i2v" ? ["41", 0] : ["11", 0];
  const negCond: [string, number] = a.mode === "i2v" ? ["41", 1] : ["12", 0];
  const latent: [string, number] = a.mode === "i2v" ? ["41", 2] : ["41", 0];

  // High-noise expert: steps 0..high (keep leftover noise for the handoff).
  // Runs at the high expert's own cfg (balanced/max use the real 3.5 here).
  g["50"] = { class_type: "ModelSamplingSD3", inputs: { model: highModelRef, shift: WAN_SHIFT } };
  g["51"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "enable",
      noise_seed: a.seed,
      steps: totalSteps,
      cfg: preset.high.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      start_at_step: 0,
      end_at_step: preset.high.steps,
      return_with_leftover_noise: "enable",
      model: ["50", 0],
      positive: posCond,
      negative: negCond,
      latent_image: latent,
    },
  };
  // Low-noise expert: steps high..total, at the low expert's own cfg.
  g["52"] = { class_type: "ModelSamplingSD3", inputs: { model: lowModelRef, shift: WAN_SHIFT } };
  g["53"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "disable",
      noise_seed: a.seed,
      steps: totalSteps,
      cfg: preset.low.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      start_at_step: preset.high.steps,
      end_at_step: totalSteps,
      return_with_leftover_noise: "disable",
      model: ["52", 0],
      positive: posCond,
      negative: negCond,
      latent_image: ["51", 0],
    },
  };

  // Memory-bounded VAE decode. A plain VAEDecode of a long clip (e.g. 8s = 128
  // frames) decodes every frame at once and spikes host RAM hard enough to OOM
  // the g6e.xlarge (32GB RAM + swap) and hang the whole box. VAEDecodeTiled
  // decodes in spatial + TEMPORAL tiles so peak memory stays bounded regardless
  // of clip length, with negligible quality loss for video. temporal_size caps
  // how many frames decode at once; this is what makes 5s/8s clips safe.
  g["60"] = {
    class_type: "VAEDecodeTiled",
    inputs: {
      samples: ["53", 0],
      vae: ["13", 0],
      tile_size: 256,
      overlap: 64,
      temporal_size: 32,
      temporal_overlap: 8,
    },
  };

  // Stage C: RIFE 2x frame interpolation. Inserted when a.interpolate is true.
  // NOTE: RIFE VFI class_type must be confirmed on the box (see top-of-file NOTE).
  if (interpolate) {
    g["62"] = {
      class_type: "RIFE VFI",
      inputs: {
        frames: ["60", 0],
        ckpt_name: RIFE_CKPT,
        clear_cache_after_n_frames: 10,
        multiplier: RIFE_MULTIPLIER,
        fast_mode: true,
        ensemble: true,
        scale_factor: 1.0,
        // These three are REQUIRED by the installed ComfyUI-Frame-Interpolation
        // RIFE VFI node; omitting them makes ComfyUI reject the graph with a 400.
        // fp16 keeps the interpolation light; torch_compile off avoids first-run
        // compile stalls; batch_size 1 matches our single-clip renders.
        dtype: "float16",
        torch_compile: false,
        batch_size: 1,
      },
    };
  }

  const framesSource: [string, number] = interpolate ? ["62", 0] : ["60", 0];
  const outFps = interpolate ? interpolatedFps() : WAN_FPS;
  g["61"] = {
    class_type: "SaveWEBM",
    // crf is required by the ComfyUI SaveWEBM node (lower = higher quality).
    inputs: { images: framesSource, filename_prefix: "poppy-wan", codec: "vp9", fps: outFps, crf: 19 },
  };
  return g;
}
