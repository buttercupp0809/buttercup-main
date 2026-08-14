// CloudFront signed URL generation for the Next.js frontend API layer.
// Uses the same env vars as backend/src/media/storage.ts.
//
// Env vars are read inside each function (not at module level) so they pick
// up the live process.env value that instrumentation.ts loads at server start.
// Module-level constants freeze at import time and miss late-loaded vars.
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

function getCfConfig() {
  return {
    url: process.env.CLOUDFRONT_URL ?? "",
    keyId: process.env.CLOUDFRONT_KEY_PAIR_ID ?? "",
    privateKey: (process.env.CLOUDFRONT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  };
}

export function isCdnConfigured(): boolean {
  const { url, keyId, privateKey } = getCfConfig();
  return Boolean(url && keyId && privateKey);
}

export function signAssetUrl(s3Key: string, ttlSeconds = 48 * 3600): string {
  const { url, keyId, privateKey } = getCfConfig();
  if (!url || !keyId || !privateKey) return `/api/media?k=${encodeURIComponent(s3Key)}`;
  const fullUrl = `${url.replace(/\/$/, "")}/${s3Key}`;
  return getSignedUrl({
    url: fullUrl,
    keyPairId: keyId,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    privateKey,
  });
}
