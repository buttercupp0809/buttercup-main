// Image provider fallback chain: Fal -> Replicate. Same shape as
// backend/src/media/voice/generate.ts. Providers are called via raw fetch
// so the file compiles without SDK deps.

import { FAL_MODELS, REPLICATE_MODELS, IMAGE_SIZE, COMFY } from "./constants";
import { resolvePoppyBaseUrl, poppyConfigured } from "../../inference/poppyEndpoint";
import { resolveImageFlags, type ImageWorkflowFlags } from "./flags";
import { assembleConsistentWorkflow } from "./workflow/assemble";
import { estimateYawFromPoseHint } from "./yaw";
import { matchPoseSkeleton, poseSchemaToSkeleton } from "./pose-library";
import type { Pose } from "@buttercupp/shared";

interface GenerateParams {
  prompt: string;
  negativePrompt: string;
  style: "realistic" | "3d" | "anime";
  referenceImageUrls: string[];
  loraRef: string | null;
  seed?: number;
  // ComfyUI LoRA: filename of the .safetensors LoRA on the box (e.g. "lora-abc.safetensors").
  // When present, a LoraLoader node is injected into the basic ComfyUI workflow.
  loraName?: string;
  // Override the checkpoint filename (e.g. when the trained LoRA was built against
  // RealVisXL instead of Juggernaut).
  ckptOverride?: string;
}

interface GenerateResult {
  buffer: Buffer;
  provider: "fal" | "replicate" | "comfyui";
  latencyMs: number;
  meta: Record<string, unknown>;
}

const disabled = { fal: false, replicate: false };
export function _resetImageDisabled(): void {
  disabled.fal = false;
  disabled.replicate = false;
}

function isAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image_download_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateWithFal(p: GenerateParams): Promise<GenerateResult> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("fal_not_configured");
  const start = performance.now();
  const size = IMAGE_SIZE[p.style];
  const res = await fetch(`https://fal.run/${FAL_MODELS[p.style]}`, {
    method: "POST",
    headers: {
      authorization: `Key ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: p.prompt,
      negative_prompt: p.negativePrompt,
      image_size: size,
      seed: p.seed,
      // IP-Adapter reference images (zero-shot consistency); ignored when
      // the model does not support them.
      image_url: p.referenceImageUrls[0],
      loras: p.loraRef ? [{ path: p.loraRef, scale: 0.8 }] : undefined,
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.fal = true;
    throw new Error(`fal_${res.status}`);
  }
  const body = (await res.json()) as { images?: { url: string }[] };
  const url = body.images?.[0]?.url;
  if (!url) throw new Error("fal_no_image");
  const buffer = await fetchImage(url);
  return {
    buffer,
    provider: "fal",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed: p.seed, model: FAL_MODELS[p.style] },
  };
}

async function generateWithReplicate(p: GenerateParams): Promise<GenerateResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("replicate_not_configured");
  const start = performance.now();
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      authorization: `Token ${token}`,
      "content-type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: REPLICATE_MODELS[p.style],
      input: {
        prompt: p.prompt,
        negative_prompt: p.negativePrompt,
        width: IMAGE_SIZE[p.style].width,
        height: IMAGE_SIZE[p.style].height,
        seed: p.seed,
      },
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.replicate = true;
    throw new Error(`replicate_${res.status}`);
  }
  const body = (await res.json()) as { output?: string | string[] };
  const url = Array.isArray(body.output) ? body.output[0] : body.output;
  if (!url) throw new Error("replicate_no_image");
  const buffer = await fetchImage(url);
  return {
    buffer,
    provider: "replicate",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed: p.seed, model: REPLICATE_MODELS[p.style] },
  };
}

// Self-hosted Juggernaut XL (photorealistic SDXL) via ComfyUI on the GPU box. Builds a minimal
// SDXL txt2img graph, queues it on /prompt, polls /history until the image is
// ready, then downloads it from /view. When loraName is provided, a LoraLoader
// node (30) is injected between the checkpoint and the CLIP/model consumers.
function buildComfyWorkflow(a: {
  ckpt: string;
  positive: string;
  negative: string;
  width: number;
  height: number;
  seed: number;
  loraName?: string;
}): Record<string, unknown> {
  // When a LoRA is present, node 30 (LoraLoader) intercepts model+clip outputs.
  const modelRef: [string, number] = a.loraName ? ["30", 0] : ["4", 0];
  const clipRef: [string, number] = a.loraName ? ["30", 1] : ["4", 1];
  const g: Record<string, unknown> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: a.width, height: a.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: clipRef } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: clipRef } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: a.seed,
        steps: COMFY.steps,
        cfg: COMFY.cfg,
        sampler_name: COMFY.samplerName,
        scheduler: COMFY.scheduler,
        denoise: 1,
        model: modelRef,
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "poppy", images: ["8", 0] } },
  };
  if (a.loraName) {
    g["30"] = {
      class_type: "LoraLoader",
      inputs: {
        model: ["4", 0],
        clip: ["4", 1],
        lora_name: a.loraName,
        strength_model: 0.85,
        strength_clip: 0.85,
      },
    };
  }
  return g;
}

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

async function generateWithComfyUI(p: GenerateParams): Promise<GenerateResult> {
  const base = await resolvePoppyBaseUrl("juggernaut"); // http://<ip>:8188
  const start = performance.now();
  const size = IMAGE_SIZE[p.style];
  // ckptOverride takes precedence (e.g. RealVisXL when the LoRA was trained on it).
  const ckpt = p.ckptOverride ?? process.env.POPPY_JUGGERNAUT_CHECKPOINT ?? COMFY.checkpoint;
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000_000_000);
  const workflow = buildComfyWorkflow({
    ckpt,
    positive: COMFY.qualityPrefix + p.prompt,
    negative: p.negativePrompt,
    width: size.width,
    height: size.height,
    seed,
    loraName: p.loraName,
  });

  const q = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `poppy-${Date.now()}` }),
  });
  if (!q.ok) throw new Error(`comfyui_${q.status}`);
  const { prompt_id: promptId } = (await q.json()) as { prompt_id?: string };
  if (!promptId) throw new Error("comfyui_no_prompt_id");

  let image: ComfyImageRef | undefined;
  for (let i = 0; i < COMFY.maxPolls; i++) {
    await new Promise((r) => setTimeout(r, COMFY.pollMs));
    const h = await fetch(`${base}/history/${promptId}`);
    if (!h.ok) continue;
    const hist = (await h.json()) as Record<
      string,
      { outputs?: Record<string, { images?: ComfyImageRef[] }> }
    >;
    const outputs = hist[promptId]?.outputs;
    if (outputs) {
      for (const nodeId of Object.keys(outputs)) {
        const imgs = outputs[nodeId].images;
        if (imgs && imgs.length > 0) {
          image = imgs[0];
          break;
        }
      }
    }
    if (image) break;
  }
  if (!image) throw new Error("comfyui_timeout");

  const view =
    `${base}/view?filename=${encodeURIComponent(image.filename)}` +
    `&subfolder=${encodeURIComponent(image.subfolder ?? "")}` +
    `&type=${encodeURIComponent(image.type ?? "output")}`;
  const buffer = await fetchImage(view);
  return {
    buffer,
    provider: "comfyui",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed, model: ckpt, promptId, ...(p.loraName ? { lora: p.loraName } : {}) },
  };
}

// ============================================================================
// Consistent-face generation (InstantID + FaceSwap + GPEN).
// Mirrors Plans/inference-aws/persona_pipeline.py so the chat pipeline produces
// the SAME character-consistent output as the command pipeline. Takes a
// reference face image (the character's primary image) and locks that exact
// face onto a prompt-driven scene.
//
// Face pose strategy: cnStrength=0 disables the ControlNet keypoint branch
// (which would lock the head direction to the reference). Identity is preserved
// by ip_weight=1.05 (ArcFace embedding) and, after KSampler, by inswapper which
// copies the exact reference face onto the generated head. Pose direction is
// driven by a text descriptor that is prepended to every prompt.
// ============================================================================
const CONSISTENT = {
  ipWeight: 1.05,
  cnStrength: 0,   // 0 = no keypoint pose lock; pose is text-driven
  endAt: 0.75,
  steps: 30,
  cfg: 4.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  width: 768,   // 9:16 vertical canvas, same as persona command pipeline
  height: 1344, // taller canvas gives vertical space for full-body head-to-toe
  instantidFile: "ip-adapter.bin",
  controlnetFile: "instantid_control.safetensors",
  // Full-body framing cluster first so CLIP weights it highest (same terms
  // as the persona command pipeline that reliably shows the complete figure).
  qualityPrefix: "full body from head to toe, entire figure visible including feet, full length wide shot, whole body inside the frame, subject centered with empty space and margin above the head and below the feet, standing far from camera, RAW photo, photorealistic, soft even lighting, bright natural light, well-lit, masterpiece, best quality, 8k uhd, dslr, sharp focus, high detail, ",
} as const;

// Pose descriptors cycled / randomly picked. Each encodes a head orientation so
// the face turns naturally instead of always copying the reference angle.
const POSE_DESCRIPTORS = [
  "looking directly at camera",
  "looking slightly to the left, relaxed",
  "looking slightly to the right, candid",
  "three-quarter view turning right",
  "three-quarter view turning left",
  "glancing over shoulder",
] as const;

// Build the consistent-face workflow. Delegates to the composable, flag-gated
// assembler (backend/src/media/image/workflow/). With all flags off the graph is
// byte-identical to the historical hand-written node map (nodes 4,5,6,7,10,
// 20-23,3,8,50,9). Flags enable additive refinement blocks (FaceDetailer, hand
// detailer, pose ControlNet, yaw-gated PuLID) without disturbing the identity lock.
function buildInstantIdWorkflow(a: {
  ckpt: string;
  positive: string;
  negative: string;
  refName: string;
  seed: number;
  flags?: ImageWorkflowFlags;
  poseHint: string;
  scene: string;
  // When the caller already resolved a skeleton name (e.g. from poseSchemaToSkeleton),
  // it takes precedence over the free-text matchPoseSkeleton result.
  poseSkeletonOverride?: string;
  // Per-character LoRA filename (e.g. "lora-abc123.safetensors"). Passed through to
  // assembleConsistentWorkflow which gates it on flags.lora + node availability.
  loraName?: string;
  skipFaceSwap?: boolean;
  refineBlend?: boolean;
  refineDenoise?: number;
}): Record<string, unknown> {
  const flags = a.flags ?? resolveImageFlags();
  return assembleConsistentWorkflow({
    ckpt: a.ckpt,
    positive: a.positive,
    negative: a.negative,
    refName: a.refName,
    seed: a.seed,
    flags,
    skipFaceSwap: a.skipFaceSwap,
    refineBlend: a.refineBlend,
    refineDenoise: a.refineDenoise,
    loraName: a.loraName,
    // Yaw is inferred from the head descriptor; the body pose skeleton (if any)
    // is matched against the user's scene request. A typed skeleton override takes
    // precedence when the caller resolved it from poseSchemaToSkeleton.
    yawDeg: estimateYawFromPoseHint(a.poseHint),
    poseSkeletonName: a.poseSkeletonOverride ?? matchPoseSkeleton(a.scene) ?? undefined,
  });
}

async function pollComfyImage(base: string, promptId: string): Promise<ComfyImageRef> {
  for (let i = 0; i < COMFY.maxPolls; i++) {
    await new Promise((r) => setTimeout(r, COMFY.pollMs));
    const h = await fetch(`${base}/history/${promptId}`);
    if (!h.ok) continue;
    const hist = (await h.json()) as Record<string, { outputs?: Record<string, { images?: ComfyImageRef[] }> }>;
    const outputs = hist[promptId]?.outputs;
    if (outputs) {
      for (const nodeId of Object.keys(outputs)) {
        const imgs = outputs[nodeId].images;
        if (imgs && imgs.length > 0) return imgs[0];
      }
    }
  }
  throw new Error("comfyui_timeout");
}

// Generate a character-consistent image: exact reference face on a prompt scene.
// poseHint: explicit head direction parsed from the user's message. When absent,
// a random POSE_DESCRIPTORS entry is used so each generation looks in a different
// direction rather than always copying the reference angle.
export async function generateWithComfyUIConsistent(p: {
  prompt: string;
  negativePrompt: string;
  referenceBytes: Buffer;
  seed?: number;
  poseHint?: string;
  // Structured pose from poseSchema; mapped to a skeleton file for the ControlNet.
  pose?: Pose;
  // Flag overrides (e.g. lora: true when a ready CharacterLora exists).
  flagOverrides?: Partial<ImageWorkflowFlags>;
  // Per-character LoRA from the character's newest ready CharacterLora.
  loraName?: string;
  // Video restyle can drop the inswapper faceswap paste (skipFaceSwap) OR keep it
  // for the exact face and blend the paste seam with a low-denoise refiner
  // (refineBlend + optional refineDenoise). The video path uses refineBlend.
  skipFaceSwap?: boolean;
  refineBlend?: boolean;
  refineDenoise?: number;
}): Promise<GenerateResult> {
  const base = await resolvePoppyBaseUrl("juggernaut");
  const start = performance.now();
  const ckpt = process.env.POPPY_JUGGERNAUT_CHECKPOINT ?? COMFY.checkpoint;
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000_000_000);
  const pose = p.poseHint ?? POSE_DESCRIPTORS[Math.floor(Math.random() * POSE_DESCRIPTORS.length)];

  // Upload the reference face into ComfyUI's input dir.
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(p.referenceBytes)], { type: "image/png" }), "chat-ref.png");
  fd.append("overwrite", "true");
  const up = await fetch(`${base}/upload/image`, { method: "POST", body: fd });
  if (!up.ok) throw new Error(`comfyui_upload_${up.status}`);
  const refName = ((await up.json()) as { name?: string }).name;
  if (!refName) throw new Error("comfyui_upload_no_name");

  // Resolve skeleton for the typed pose (if any) so the ControlNet block
  // gets the filename. Precedence: structured pose > free-text scene match.
  const typedSkeleton = p.pose ? poseSchemaToSkeleton(p.pose) : undefined;

  // Merge flag overrides (e.g. lora:true from the handler) into env-resolved flags.
  const flags = resolveImageFlags(p.flagOverrides);

  const workflow = buildInstantIdWorkflow({
    ckpt,
    positive: `${pose}, ${CONSISTENT.qualityPrefix}${p.prompt}`,
    negative: p.negativePrompt,
    refName,
    seed,
    flags,
    poseHint: pose,
    scene: p.prompt,
    // When a typed skeleton was resolved, it takes precedence over the free-text
    // scene match done inside buildInstantIdWorkflow.
    poseSkeletonOverride: typedSkeleton ?? undefined,
    skipFaceSwap: p.skipFaceSwap,
    refineBlend: p.refineBlend,
    refineDenoise: p.refineDenoise,
    loraName: p.loraName,
  });
  const q = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `poppy-chat-${Date.now()}` }),
  });
  if (!q.ok) throw new Error(`comfyui_${q.status}`);
  const { prompt_id: promptId } = (await q.json()) as { prompt_id?: string };
  if (!promptId) throw new Error("comfyui_no_prompt_id");

  const image = await pollComfyImage(base, promptId);
  const view =
    `${base}/view?filename=${encodeURIComponent(image.filename)}` +
    `&subfolder=${encodeURIComponent(image.subfolder ?? "")}` +
    `&type=${encodeURIComponent(image.type ?? "output")}`;
  const buffer = await fetchImage(view);
  return {
    buffer,
    provider: "comfyui",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed, model: ckpt, promptId, method: "instantid+facedetailer+faceswap" },
  };
}

export async function generateImage(p: GenerateParams): Promise<GenerateResult> {
  const attempts: Array<() => Promise<GenerateResult>> = [];
  // Self-hosted Juggernaut/ComfyUI is primary when configured; cloud providers back it up.
  if (poppyConfigured()) attempts.push(() => generateWithComfyUI(p));
  if (!disabled.fal) attempts.push(() => generateWithFal(p));
  if (!disabled.replicate) attempts.push(() => generateWithReplicate(p));
  let lastErr: unknown = new Error("no_image_providers");
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
