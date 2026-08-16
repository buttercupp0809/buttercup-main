// Best-effort S3 cleanup for character deletion. Batches DeleteObjects per
// bucket (frontend/lib/s3-delete.ts is called from DELETE
// /api/characters/[id]) and never throws: a failed delete leaves the DB
// row already gone, so we log + report and let a background sweeper (out
// of scope for Phase 31.1) reap orphan objects if needed.
//
// Bucket routing matches frontend/app/api/media/route.ts: keys starting
// with `images/` land in POPPY_S3_BUCKET_GENERATED, everything else in
// S3_BUCKET. Local paths (/personas/*) and unknown-scheme URLs are
// dropped by extractS3Key.

import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

// Pull a bare S3 key out of a stored URL / key. Returns null when the
// url is a local /public path (seed art) or a scheme we do not own. The
// full CloudFront URL case strips the CDN host + any signing query so
// only the path remains.
export function extractS3Key(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/api/media")) {
    try {
      const q = url.indexOf("?");
      const params = new URLSearchParams(q >= 0 ? url.slice(q) : "");
      const k = params.get("k");
      return k && k.length > 0 ? k : null;
    } catch {
      return null;
    }
  }
  if (url.startsWith("/")) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\/+/, "");
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }
  return url;
}

function bucketFor(key: string, generatedBucket: string, mediaBucket: string): string {
  if (key.startsWith("images/")) return generatedBucket;
  return mediaBucket;
}

export interface S3DeleteReport {
  attempted: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

// Delete a list of S3 keys, batched per bucket. Non-throwing.
export async function deleteS3Keys(keys: readonly string[]): Promise<S3DeleteReport> {
  const report: S3DeleteReport = { attempted: 0, deleted: 0, skipped: 0, errors: [] };
  const filtered = keys.filter((k): k is string => typeof k === "string" && k.length > 0);
  if (filtered.length === 0) return report;

  const region = process.env.AWS_REGION ?? "eu-north-1";
  const generatedBucket = process.env.POPPY_S3_BUCKET_GENERATED ?? "";
  const mediaBucket = process.env.S3_BUCKET ?? "";
  const endpoint = process.env.S3_ENDPOINT || undefined;

  if (!generatedBucket && !mediaBucket) {
    // S3 not configured (dev without MinIO). Skip cleanly so a local
    // delete still succeeds against Postgres.
    report.skipped = filtered.length;
    return report;
  }

  const byBucket = new Map<string, string[]>();
  for (const key of filtered) {
    const bucket = bucketFor(key, generatedBucket, mediaBucket);
    if (!bucket) {
      report.skipped += 1;
      continue;
    }
    const list = byBucket.get(bucket) ?? [];
    list.push(key);
    byBucket.set(bucket, list);
  }

  const s3 = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  // DeleteObjects caps at 1000 keys per request; batch defensively.
  const CHUNK = 900;
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      report.attempted += chunk.length;
      try {
        const cmd = new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        });
        const res = await s3.send(cmd);
        const errs = (res.Errors ?? []) as Array<{ Key?: string; Code?: string; Message?: string }>;
        report.deleted += chunk.length - errs.length;
        for (const e of errs) {
          report.errors.push(`${bucket}:${e.Key ?? "?"}:${e.Code ?? "err"}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`${bucket}:batch:${msg}`);
      }
    }
  }
  return report;
}
