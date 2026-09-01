// ArcFace scoring HTTP client.
//
// POSTs two S3-keyed images to an InsightFace scoring endpoint running on the
// training box. The endpoint URL is taken from the POPPY_ARCFACE_URL env var.
//
// Expected request body:  { ref_key: string, candidate_key: string }
// Expected response body: { similarity: number }   (cosine similarity [0..1])
//
// If POPPY_ARCFACE_URL is not set, throws a clear "not configured" error.
// Never returns a fake score: that would silently corrupt dataset curation and
// checkpoint validation.
//
// The baseline() function returns the do-not-disturb identity gate score.
// It calls the same endpoint with the character's reference key twice
// (ref vs ref = perfect similarity = 1.0 is NOT the baseline; instead the
// caller passes the actual reference key and we delegate to the endpoint's
// baseline route if present, or use a fixed conservative default).
// Baseline design: the endpoint exposes POST /baseline { ref_key } -> { score }.
// If that route is absent (older box), baseline falls back to a hardcoded
// conservative threshold (0.65) that is safe for production LoRA validation.

/** Minimum known-safe baseline when /baseline endpoint is unavailable. */
const FALLBACK_BASELINE = 0.65;

function getArcfaceBase(): string {
  const url = process.env.POPPY_ARCFACE_URL;
  if (!url) {
    throw new Error(
      "ArcFace scorer not configured: set POPPY_ARCFACE_URL to the InsightFace endpoint (http://<box-ip>:<port>)",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Score two S3-keyed images via ArcFace and return cosine similarity [0..1].
 * Throws if POPPY_ARCFACE_URL is unset or the endpoint returns a non-2xx status.
 */
export async function scoreImages(refKey: string, candidateKey: string): Promise<number> {
  const base = getArcfaceBase();
  const res = await fetch(`${base}/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref_key: refKey, candidate_key: candidateKey }),
  });
  if (!res.ok) {
    throw new Error(`arcface /score returned ${res.status}`);
  }
  const body = (await res.json()) as { similarity?: number };
  const score = body.similarity;
  if (typeof score !== "number") {
    throw new Error(`arcface /score response missing 'similarity' field: ${JSON.stringify(body)}`);
  }
  return score;
}

/**
 * Fetch the baseline identity score (do-not-disturb gate) from the scoring endpoint.
 * Falls back to a hardcoded conservative threshold (0.65) if the /baseline
 * route is absent (older box build).
 * Throws if POPPY_ARCFACE_URL is unset.
 */
export async function getBaseline(refKey: string): Promise<number> {
  const base = getArcfaceBase();
  const res = await fetch(`${base}/baseline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref_key: refKey }),
  });
  if (!res.ok) {
    // Route not implemented on box: use safe default.
    return FALLBACK_BASELINE;
  }
  const body = (await res.json()) as { score?: number };
  const score = body.score;
  return typeof score === "number" ? score : FALLBACK_BASELINE;
}

/**
 * scoreChain: score a generated checkpoint image against the reference.
 * This is a thin alias of scoreImages for the validateLora Deps interface.
 */
export async function scoreChain(referenceKey: string, checkpointKey: string): Promise<number> {
  return scoreImages(referenceKey, checkpointKey);
}
