// Server-side secure blur for paywalled chat media. Mirrors
// frontend/lib/media-blur.ts so the live SSE/WS delivery path (which runs in
// the backend, not Next.js) can hand a free viewer a blurred inline data URI
// instead of the full-resolution image.
//
// The trick: fetch the real bytes on the server, downscale to a tiny
// thumbnail, blur, and return ONLY a base64 data URI of those worthless
// bytes. There is no URL to open, no key to feed the media proxy, and the
// downscaled+blurred bytes carry no recoverable detail.

import { fetchObjectBytes } from "./storage";

// Same visual fallback shape the frontend module uses: a dark gradient SVG.
const FALLBACK =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2533"/><stop offset="1" stop-color="#1a1720"/></linearGradient></defs><rect width="32" height="48" fill="url(#g)"/></svg>`,
  ).toString("base64");

type SharpFn = (input: Buffer) => {
  resize: (w: number, h: number, opts: { fit: string; position: string }) => {
    blur: (sigma: number) => {
      webp: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> };
    };
  };
};

let _sharp: SharpFn | null | undefined = undefined;

// Load the sharp factory. Depending on the module interop (CJS require vs the
// vitest/ESM transform) `require("sharp")` is either the callable itself or a
// namespace object with the callable on `.default`; handle both so the blur
// works under both the compiled backend runtime and the test runner.
function loadSharp(): SharpFn | null {
  if (_sharp !== undefined) return _sharp;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("sharp") as SharpFn | { default?: SharpFn };
    const fn = typeof mod === "function" ? mod : mod.default;
    _sharp = typeof fn === "function" ? fn : null;
    return _sharp;
  } catch {
    _sharp = null;
    return null;
  }
}

// Process-lifetime cache so repeated deliveries of the same s3Key (live event
// then history reload) do not re-fetch and re-blur. Data URIs are ~1-2 KB.
const cache = new Map<string, string>();

// Returns a blurred inline data URI for the given s3Key. Never throws; on any
// failure (storage down, unknown key, sharp missing) it returns the dark
// gradient FALLBACK, which is itself a valid data URI, so a locked bubble
// always has a real blurUri to render.
export async function blurredDataUriForKey(s3Key: string): Promise<string> {
  if (!s3Key) return FALLBACK;
  const cached = cache.get(s3Key);
  if (cached) return cached;

  const bytes = await fetchObjectBytes(s3Key);
  if (!bytes) {
    cache.set(s3Key, FALLBACK);
    return FALLBACK;
  }
  const sharp = loadSharp();
  if (!sharp) {
    cache.set(s3Key, FALLBACK);
    return FALLBACK;
  }
  try {
    const out = await sharp(bytes)
      .resize(32, 48, { fit: "cover", position: "top" })
      .blur(6)
      .webp({ quality: 45 })
      .toBuffer();
    const uri = `data:image/webp;base64,${out.toString("base64")}`;
    cache.set(s3Key, uri);
    return uri;
  } catch {
    cache.set(s3Key, FALLBACK);
    return FALLBACK;
  }
}
