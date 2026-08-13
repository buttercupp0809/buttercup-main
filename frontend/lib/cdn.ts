// CloudFront signed URL generation for the Next.js frontend API layer.
// Uses the same env vars as backend/src/media/storage.ts.
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const CF_URL = process.env.CLOUDFRONT_URL ?? "";
const CF_KEY_ID = process.env.CLOUDFRONT_KEY_PAIR_ID ?? "";
const CF_PRIVATE_KEY = (process.env.CLOUDFRONT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

export function isCdnConfigured(): boolean {
  return Boolean(CF_URL && CF_KEY_ID && CF_PRIVATE_KEY);
}

export function signAssetUrl(s3Key: string, ttlSeconds = 48 * 3600): string {
  if (!isCdnConfigured()) return `/api/media?k=${encodeURIComponent(s3Key)}`; // proxy route until CloudFront is wired up
  const url = `${CF_URL.replace(/\/$/, "")}/${s3Key}`;
  return getSignedUrl({
    url,
    keyPairId: CF_KEY_ID,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    privateKey: CF_PRIVATE_KEY,
  });
}
