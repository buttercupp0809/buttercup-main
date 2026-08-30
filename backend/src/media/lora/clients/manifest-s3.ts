// Dataset manifest S3 uploader.
//
// Serialises the DatasetManifest as JSON and puts it into the training dataset
// bucket under a deterministic key so the training box can reconstruct the
// image list. Uses the existing loadS3() helper from media/storage.ts via the
// same internal pattern (require + PutObjectCommand) so a new S3Client is never
// constructed here.
//
// Key convention:
//   lora/<characterId>/<characterVersionId>/manifest-<isoDate>.json
//
// Bucket: POPPY_S3_BUCKET_GENERATED (generated assets bucket, same as images).
// Falls back to S3_BUCKET if POPPY_S3_BUCKET_GENERATED is unset (local dev).
// Throws if neither bucket env var is set.

import crypto from "node:crypto";
import type { DatasetManifest } from "../dataset";

// S3 dep types mirrored from media/storage.ts internal shape.
interface S3Deps {
  client: unknown;
  PutObjectCommand: unknown;
}

function loadS3(): S3Deps {

  const s3 = require("@aws-sdk/client-s3");
  const client = new s3.S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
  return { client, PutObjectCommand: s3.PutObjectCommand };
}

/**
 * Upload a DatasetManifest as JSON to S3 and return the storage key.
 *
 * Throws if neither POPPY_S3_BUCKET_GENERATED nor S3_BUCKET is set.
 */
export async function uploadManifestToS3(manifest: DatasetManifest): Promise<string> {
  const bucket =
    process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("uploadManifest: POPPY_S3_BUCKET_GENERATED (or S3_BUCKET) not configured");
  }

  const { characterId, characterVersionId } = manifest;
  const dateTag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uid = crypto.randomUUID().slice(0, 8);
  const key = `lora/${characterId}/${characterVersionId}/manifest-${dateTag}-${uid}.json`;

  const body = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

  const deps = loadS3();
  const PutCtor = deps.PutObjectCommand as new (args: Record<string, unknown>) => unknown;
  const cmd = new PutCtor({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/json",
  });
  const send = (deps.client as { send: (c: unknown) => Promise<unknown> }).send.bind(deps.client);
  await send(cmd);
  return key;
}
