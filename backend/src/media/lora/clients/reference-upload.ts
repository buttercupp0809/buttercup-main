// Uploads a character's primary image to poppy-generated under the LoRA
// reference key so the training-box ArcFace scorer can use it as the identity
// ground truth.
//
// Key convention: ref/<characterId>/<characterVersionId>
// Bucket: POPPY_S3_BUCKET_GENERATED (same bucket the training box reads from).
//
// This step runs once per training job, before dataset building. It is
// idempotent: a second call for the same character version overwrites the key
// with the same bytes.

import { prisma } from "@buttercupp/database";
import { bucketForKey, getRawFromS3, putRawToS3 } from "../../storage";

/**
 * Copy the character's primary image from its source bucket to
 * poppy-generated under ref/<characterId>/<characterVersionId>.
 *
 * Returns the destination S3 key on success.
 * Throws if no image is found or S3 is not configured.
 */
export async function uploadReferenceImage(
  characterId: string,
  characterVersionId: string,
): Promise<string> {
  const destBucket = process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET;
  if (!destBucket) throw new Error("POPPY_S3_BUCKET_GENERATED not configured");

  // Resolve the character's primary image key. Prefer isPrimary=true; fall
  // back to the first non-hidden image sorted by sort asc.
  let row = await prisma.characterMedia.findFirst({
    where: { characterId, kind: "image", hidden: false, isPrimary: true },
    select: { url: true },
  });
  if (!row) {
    row = await prisma.characterMedia.findFirst({
      where: { characterId, kind: "image", hidden: false },
      orderBy: { sort: "asc" },
      select: { url: true },
    });
  }
  if (!row) {
    throw new Error(`no image found for character ${characterId} to use as LoRA reference`);
  }

  const srcKey = row.url;
  const srcBucket = bucketForKey(srcKey) || destBucket;

  const bytes = await getRawFromS3(srcBucket, srcKey);

  // Infer content type from the source key extension.
  const ext = srcKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "image/webp";

  const destKey = `ref/${characterId}/${characterVersionId}`;
  await putRawToS3(destBucket, destKey, bytes, contentType);
  return destKey;
}
