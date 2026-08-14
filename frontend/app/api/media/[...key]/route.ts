// S3 media proxy. Generates a pre-signed S3 GET URL and redirects to it.
// Used as a fallback when CloudFront is not configured.
// Primary images (on public character pages) are served through this route
// without auth. Gallery images are protected by the page that renders them.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getS3Config() {
  return {
    region: process.env.AWS_REGION ?? "eu-north-1",
    generatedBucket: process.env.POPPY_S3_BUCKET_GENERATED ?? "",
    mediaBucket: process.env.S3_BUCKET ?? "",
  };
}

function bucketForKey(key: string, generatedBucket: string, mediaBucket: string): string {
  if (key.startsWith("images/")) return generatedBucket;
  return mediaBucket;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await ctx.params;
  const s3Key = segments.join("/");

  const { region, generatedBucket, mediaBucket } = getS3Config();
  const bucket = bucketForKey(s3Key, generatedBucket, mediaBucket);
  if (!bucket) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  try {
    const s3 = new S3Client({ region });
    const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return NextResponse.redirect(url, { status: 302 });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
