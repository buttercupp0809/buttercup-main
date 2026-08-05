// Image provider fallback chain: Fal -> Replicate. Same shape as
// backend/src/media/voice/generate.ts. Providers are called via raw fetch
// so the file compiles without SDK deps.

import { FAL_MODELS, REPLICATE_MODELS, IMAGE_SIZE } from "./constants";

interface GenerateParams {
  prompt: string;
  negativePrompt: string;
  style: "realistic" | "3d" | "anime";
  referenceImageUrls: string[];
  loraRef: string | null;
  seed?: number;
}

interface GenerateResult {
  buffer: Buffer;
  provider: "fal" | "replicate";
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

export async function generateImage(p: GenerateParams): Promise<GenerateResult> {
  const attempts: Array<() => Promise<GenerateResult>> = [];
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
