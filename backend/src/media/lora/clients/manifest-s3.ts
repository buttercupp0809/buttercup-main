// Dataset manifest S3 uploader.
//
// Serialises the DatasetManifest as JSON and puts it into the training dataset
// bucket under a deterministic key so the training box can reconstruct the
// image list. Reuses putRawToS3 from media/storage.ts, which uses the SAME
// singleton S3 client + forcePathStyle/endpoint/region logic as uploadGenerated.
// No ad-hoc S3Client is constructed here.
//
// Key convention:
//   lora/<characterId>/<characterVersionId>/manifest-<isoDate>-<uid>.json
//
// Bucket: POPPY_S3_BUCKET_GENERATED (generated assets bucket, same as images).
// Falls back to S3_BUCKET if POPPY_S3_BUCKET_GENERATED is unset (local dev).
// Throws if neither bucket env var is set.

import crypto from "node:crypto";
import type { DatasetManifest } from "../dataset";
import { putRawToS3 } from "../../storage";

function generatedBucket(): string {
  const bucket = process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET;
  if (!bucket) throw new Error("uploadManifest: POPPY_S3_BUCKET_GENERATED (or S3_BUCKET) not configured");
  return bucket;
}

/**
 * Upload a single image caption as a .txt sidecar to S3.
 * Key: <imageKey>.txt  (same bucket as the image itself).
 * Best-effort: logs on failure rather than throwing, so a captioning gap
 * never aborts the training job.
 */
export async function uploadCaptionTxt(imageKey: string, caption: string): Promise<void> {
  try {
    const bucket = generatedBucket();
    await putRawToS3(bucket, `${imageKey}.txt`, Buffer.from(caption, "utf8"), "text/plain");
  } catch (err) {
    console.warn(`[lora] uploadCaptionTxt failed for ${imageKey}:`, err);
  }
}

/**
 * Upload a DatasetManifest as JSON to S3 and return the storage key.
 *
 * Throws if neither POPPY_S3_BUCKET_GENERATED nor S3_BUCKET is set.
 */
export async function uploadManifestToS3(manifest: DatasetManifest): Promise<string> {
  const bucket = generatedBucket();
  const { characterId, characterVersionId } = manifest;
  const dateTag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uid = crypto.randomUUID().slice(0, 8);
  const key = `lora/${characterId}/${characterVersionId}/manifest-${dateTag}-${uid}.json`;

  const body = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await putRawToS3(bucket, key, body, "application/json");
  return key;
}
