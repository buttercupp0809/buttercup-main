import "server-only";

// Server-only secure blur for paywalled media.
//
// Locked gallery tiles must show a preview WITHOUT ever putting a real,
// downloadable URL (or the S3 key) into the client HTML. The trick: on the
// server we fetch the real image, downscale it to a tiny thumbnail, blur it,
// and hand the client ONLY a base64 data URI of those worthless bytes. There
// is no URL to open in a new tab, no key to feed the /api/media proxy, and the
// downscaled+blurred bytes carry no recoverable detail.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "eu-north-1" });
const GENERATED_BUCKET = process.env.POPPY_S3_BUCKET_GENERATED ?? "";
const MEDIA_BUCKET = process.env.S3_BUCKET ?? "";

// Neutral placeholder used whenever we cannot produce a real blur (missing
// bytes, sharp unavailable, S3 error). A flat gradient, never the real image.
const FALLBACK =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2533"/><stop offset="1" stop-color="#1a1720"/></linearGradient></defs><rect width="32" height="48" fill="url(#g)"/></svg>`,
  ).toString("base64");

function bucketForKey(key: string): string {
  if (key.startsWith("images/")) return GENERATED_BUCKET;
  return MEDIA_BUCKET;
}

// Resolve the raw image bytes for a value that may be a full https URL, the
// local /api/media proxy URL (?k=<key>), or a bare S3 key. Public paths
// (starting with /personas or similar) are not secret and return null so the
// caller uses the fallback.
async function fetchBytes(src: string): Promise<Buffer | null> {
  try {
    if (/^https?:\/\//i.test(src)) {
      const r = await fetch(src);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    // Local proxy URL: /api/media?k=<key>
    if (src.startsWith("/api/media")) {
      const key = new URL(src, "http://local").searchParams.get("k");
      if (!key) return null;
      return fetchS3(key);
    }
    // Public asset path (/personas/x.webp), not secret, no blur needed.
    if (src.startsWith("/")) return null;
    // Otherwise treat as a bare S3 key.
    return fetchS3(src);
  } catch {
    return null;
  }
}

async function fetchS3(key: string): Promise<Buffer | null> {
  const bucket = bucketForKey(key);
  if (!bucket) return null;
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = obj.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) return null;
  return Buffer.from(await body.transformToByteArray());
}

// Process-lifetime cache so repeated renders of the same page do not re-fetch
// and re-blur. Keyed by the source string. Data URIs are small (~1-2 KB).
const cache = new Map<string, string>();

export async function blurredDataUri(src: string): Promise<string> {
  if (!src) return FALLBACK;
  const cached = cache.get(src);
  if (cached) return cached;

  const bytes = await fetchBytes(src);
  if (!bytes) {
    cache.set(src, FALLBACK);
    return FALLBACK;
  }
  try {
    // sharp is hoisted at the repo root node_modules (Next bundles it too).
    const sharpMod = (await import("sharp")).default;
    const out = await sharpMod(bytes)
      .resize(32, 48, { fit: "cover", position: "top" })
      .blur(6)
      .webp({ quality: 45 })
      .toBuffer();
    const uri = `data:image/webp;base64,${out.toString("base64")}`;
    cache.set(src, uri);
    return uri;
  } catch {
    cache.set(src, FALLBACK);
    return FALLBACK;
  }
}

// Blur several sources in parallel. Order-preserving.
export async function blurMany(srcs: string[]): Promise<string[]> {
  return Promise.all(srcs.map((s) => blurredDataUri(s)));
}
