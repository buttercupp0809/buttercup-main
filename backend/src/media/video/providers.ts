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
} from "./constants";

interface GenerateParams {
  prompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  seconds: number;
  seed?: number;
}

interface GenerateResult {
  buffer: Buffer;
  provider: "fal" | "replicate";
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
  if (!videoProvidersConfigured()) throw new VideoNotConfiguredError();
  const attempts: Array<() => Promise<GenerateResult>> = [];
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
