// Video provider fallback chain: Fal -> Replicate. Same shape as
// media/image/providers.ts. Providers are called via raw fetch so the file
// compiles without SDK deps. A provider is skipped when either its API key or
// its model slug (constants.ts) is unset, so the chain degrades cleanly to
// "no providers configured" in dev.

import {
  FAL_VIDEO_MODEL,
  REPLICATE_VIDEO_MODEL,
  VIDEO_SIZE,
  VIDEO_DEFAULT_SECONDS,
  VIDEO_FPS,
  VIDEO_DEFAULT_ASPECT,
  WAN_DEFAULT_PRESET,
  WAN_STEPS,
  videoSelfHostConfigured,
  videoInterpolationEnabled,
  type VideoAspect,
  type WanPreset,
} from "./constants";
import { resolveVideoBaseUrl, videoConfigured } from "../../inference/videoEndpoint";
import { buildWanWorkflow } from "./workflow";

interface GenerateParams {
  prompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  seconds: number;
  seed?: number;
  // Self-hosted Wan options (ignored by the cloud providers). When mode is
  // absent it is inferred: a reference frame present => i2v, else t2v.
  mode?: "t2v" | "i2v";
  aspect?: VideoAspect;
  preset?: WanPreset;
  // Preferred i2v reference: raw image bytes to upload to the box directly.
  // Avoids re-fetching a URL that may resolve to a non-image (the cause of the
  // box LoadImage failure). Falls back to referenceImageUrls[0] when absent.
  referenceBytes?: Buffer;
}

interface GenerateResult {
  buffer: Buffer;
  provider: "fal" | "replicate" | "comfywan";
  latencyMs: number;
  meta: Record<string, unknown>;
}

export class VideoNotConfiguredError extends Error {
  constructor() {
    super("video_no_providers_configured");
    this.name = "VideoNotConfiguredError";
  }
}

const disabled = { fal: false, replicate: false };
export function _resetVideoDisabled(): void {
  disabled.fal = false;
  disabled.replicate = false;
}

function isAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

async function fetchVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`video_download_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateWithFal(p: GenerateParams): Promise<GenerateResult> {
  const key = process.env.FAL_KEY;
  if (!key || !FAL_VIDEO_MODEL) throw new Error("fal_video_not_configured");
  const start = performance.now();
  const res = await fetch(`https://fal.run/${FAL_VIDEO_MODEL}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: p.prompt,
      negative_prompt: p.negativePrompt,
      image_size: VIDEO_SIZE,
      num_frames: p.seconds * VIDEO_FPS,
      fps: VIDEO_FPS,
      seed: p.seed,
      image_url: p.referenceImageUrls[0],
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.fal = true;
    throw new Error(`fal_video_${res.status}`);
  }
  const body = (await res.json()) as { video?: { url: string } };
  const url = body.video?.url;
  if (!url) throw new Error("fal_no_video");
  const buffer = await fetchVideo(url);
  return {
    buffer,
    provider: "fal",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed: p.seed, model: FAL_VIDEO_MODEL },
  };
}

async function generateWithReplicate(p: GenerateParams): Promise<GenerateResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token || !REPLICATE_VIDEO_MODEL) throw new Error("replicate_video_not_configured");
  const start = performance.now();
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      authorization: `Token ${token}`,
      "content-type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: REPLICATE_VIDEO_MODEL,
      input: {
        prompt: p.prompt,
        negative_prompt: p.negativePrompt,
        width: VIDEO_SIZE.width,
        height: VIDEO_SIZE.height,
        num_frames: p.seconds * VIDEO_FPS,
        fps: VIDEO_FPS,
        seed: p.seed,
      },
    }),
  });
  if (!res.ok) {
    if (isAuthError(res.status)) disabled.replicate = true;
    throw new Error(`replicate_video_${res.status}`);
  }
  const body = (await res.json()) as { output?: string | string[] };
  const url = Array.isArray(body.output) ? body.output[0] : body.output;
  if (!url) throw new Error("replicate_no_video");
  const buffer = await fetchVideo(url);
  return {
    buffer,
    provider: "replicate",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed: p.seed, model: REPLICATE_VIDEO_MODEL },
  };
}

// Self-hosted Wan 2.2 A14B via ComfyUI on the dedicated video box. Mirrors the
// image generateWithComfyUI submit/poll/download pattern, but builds a Wan
// two-expert graph. Mode is inferred from the presence of a reference frame when
// not set explicitly. Video jobs take minutes, so the poll window is long.
interface ComfyVideoRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

async function generateWithComfyWan(p: GenerateParams): Promise<GenerateResult> {
  const base = await resolveVideoBaseUrl();
  const start = performance.now();
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000_000_000);
  const aspect = p.aspect ?? VIDEO_DEFAULT_ASPECT;
  const preset = p.preset ?? WAN_DEFAULT_PRESET;
  const mode: "t2v" | "i2v" =
    p.mode ?? (p.referenceBytes || p.referenceImageUrls[0] ? "i2v" : "t2v");

  let refName: string | undefined;
  if (mode === "i2v") {
    // Prefer raw bytes (already validated as a real image upstream). Only fetch
    // a URL if bytes were not supplied.
    let bytes = p.referenceBytes;
    if (!bytes) {
      const src = p.referenceImageUrls[0];
      if (!src) throw new Error("comfywan_i2v_no_reference");
      bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    }
    // Unique filename per job so concurrent renders never clobber each other's
    // reference frame in the box's shared input dir.
    const uploadName = `wan-ref-${seed}.png`;
    const fd = new FormData();
    fd.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), uploadName);
    fd.append("overwrite", "true");
    const up = await fetch(`${base}/upload/image`, { method: "POST", body: fd });
    if (!up.ok) throw new Error(`comfywan_upload_${up.status}`);
    refName = ((await up.json()) as { name?: string }).name;
    if (!refName) throw new Error("comfywan_upload_no_name");
  }

  const interpolate = WAN_STEPS[preset].interpolate && videoInterpolationEnabled();
  const workflow = buildWanWorkflow({
    mode,
    positive: p.prompt,
    negative: p.negativePrompt,
    aspect,
    seconds: p.seconds,
    seed,
    preset,
    refImageName: refName,
    interpolate,
  });
  const q = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `poppy-wan-${Date.now()}` }),
  });
  if (!q.ok) throw new Error(`comfywan_${q.status}`);
  const { prompt_id: promptId } = (await q.json()) as { prompt_id?: string };
  if (!promptId) throw new Error("comfywan_no_prompt_id");

  // Poll /history (check first, then sleep). Video jobs take minutes; poll for
  // up to ~20 min.
  let ref: ComfyVideoRef | undefined;
  for (let i = 0; i < 240; i++) {
    const h = await fetch(`${base}/history/${promptId}`);
    if (h.ok) {
      const hist = (await h.json()) as Record<
        string,
        { outputs?: Record<string, { gifs?: ComfyVideoRef[]; images?: ComfyVideoRef[] }> }
      >;
      const outputs = hist[promptId]?.outputs;
      if (outputs) {
        for (const nodeId of Object.keys(outputs)) {
          const media = outputs[nodeId].gifs ?? outputs[nodeId].images;
          if (media && media.length > 0) {
            ref = media[0];
            break;
          }
        }
      }
    }
    if (ref) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!ref) throw new Error("comfywan_timeout");
  const view =
    `${base}/view?filename=${encodeURIComponent(ref.filename)}` +
    `&subfolder=${encodeURIComponent(ref.subfolder ?? "")}` +
    `&type=${encodeURIComponent(ref.type ?? "output")}`;
  const buffer = await fetchVideo(view);
  return {
    buffer,
    provider: "comfywan",
    latencyMs: Math.round(performance.now() - start),
    meta: { seed, mode, preset, aspect },
  };
}

// True when at least one provider has both a key and a model slug set.
export function videoProvidersConfigured(): boolean {
  const fal = Boolean(process.env.FAL_KEY && FAL_VIDEO_MODEL);
  const replicate = Boolean(process.env.REPLICATE_API_TOKEN && REPLICATE_VIDEO_MODEL);
  return fal || replicate;
}

export async function generateVideo(
  p: Omit<GenerateParams, "seconds"> & { seconds?: number },
): Promise<GenerateResult> {
  const params: GenerateParams = { ...p, seconds: p.seconds ?? VIDEO_DEFAULT_SECONDS };
  if (!videoSelfHostConfigured() && !videoProvidersConfigured()) throw new VideoNotConfiguredError();
  const attempts: Array<() => Promise<GenerateResult>> = [];
  // Self-hosted Wan box is primary when configured; cloud providers back it up.
  if (videoSelfHostConfigured() && videoConfigured()) attempts.push(() => generateWithComfyWan(params));
  if (!disabled.fal) attempts.push(() => generateWithFal(params));
  if (!disabled.replicate) attempts.push(() => generateWithReplicate(params));
  let lastErr: unknown = new VideoNotConfiguredError();
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
