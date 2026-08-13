// S3 media proxy. Accepts ?k=<s3Key>, generates a pre-signed S3 GET URL,
// and redirects (302) to it. Using a query param avoids Next.js treating
// the URL as a static-file request when the key ends in .png / .jpg etc.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "eu-north-1" });
const GENERATED_BUCKET = process.env.POPPY_S3_BUCKET_GENERATED ?? "";
const MEDIA_BUCKET = process.env.S3_BUCKET ?? "";

function bucketForKey(key: string): string {
  if (key.startsWith("images/")) return GENERATED_BUCKET;
  return MEDIA_BUCKET;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const s3Key = searchParams.get("k");

  if (!s3Key) {
    return NextResponse.json({ error: "missing_key" }, { status: 400 });
  }

  const bucket = bucketForKey(s3Key);
  if (!bucket) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return NextResponse.redirect(url, { status: 302 });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
