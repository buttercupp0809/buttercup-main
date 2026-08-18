// S3 media proxy. Accepts ?k=<s3Key>, generates a pre-signed S3 GET URL,
// and redirects (302) to it. Using a query param avoids Next.js treating
// the URL as a static-file request when the key ends in .png / .jpg etc.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Read env vars inside the handler (not at module level) so instrumentation.ts
// has time to load them from server-env.json before they are captured.
function getS3Config() {
  return {
    region: process.env.AWS_REGION ?? "eu-north-1",
    generatedBucket: process.env.POPPY_S3_BUCKET_GENERATED ?? "",
    reelsBucket: process.env.POPPY_S3_BUCKET_REELS ?? "",
    mediaBucket: process.env.S3_BUCKET ?? "",
    // MinIO/LocalStack override for local dev, mirroring backend/src/media/storage.ts.
    endpoint: process.env.S3_ENDPOINT || undefined,
  };
}

function bucketForKey(
  key: string,
  generatedBucket: string,
  reelsBucket: string,
  mediaBucket: string,
): string {
  if (key.startsWith("images/")) return generatedBucket;
  if (key.startsWith("reels/")) return reelsBucket;
  return mediaBucket;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const s3Key = searchParams.get("k");

  if (!s3Key) {
    return NextResponse.json({ error: "missing_key" }, { status: 400 });
  }

  const { region, generatedBucket, reelsBucket, mediaBucket, endpoint } = getS3Config();
  const bucket = bucketForKey(s3Key, generatedBucket, reelsBucket, mediaBucket);
  if (!bucket) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  try {
    const s3 = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    return NextResponse.json({ error: "not_found", bucket, region, detail: String(err).slice(0, 200) }, { status: 404 });
  }
}
