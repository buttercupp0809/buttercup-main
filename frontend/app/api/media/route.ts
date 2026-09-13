// S3 media proxy. Accepts ?k=<s3Key>, generates a pre-signed S3 GET URL,
// and redirects (302) to it. Using a query param avoids Next.js treating
// the URL as a static-file request when the key ends in .png / .jpg etc.
//
// Security (free-tier paywall, FAIL CLOSED): when the key resolves to a
// generated chat-image MediaAsset (kind:"image", status:"ready"), the route
// serves the REAL full-resolution URL ONLY to an authenticated AND paid/active
// requester. In every other case for such a key (unauthenticated / null-auth
// requester OR a free authenticated requester), it serves blurred bytes. A
// leaked s3Key therefore cannot exfiltrate the clear image, even without a
// cookie. Keys that do NOT resolve to a generated-image MediaAsset (avatars,
// public character art, reels) keep resolving normally, so public assets are
// never over-blurred.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { getAuthUserId } from "@/lib/auth";
import { blurredDataUri } from "@/lib/media-blur";

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

// Returns true when the authenticated user is free (no active paid subscription).
async function isFreeUser(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  });
  if (!sub) return true;
  const paidActive =
    sub.status === "active" &&
    sub.plan !== null &&
    sub.plan !== "free" &&
    (sub.currentPeriodEnd === null || sub.currentPeriodEnd.getTime() > Date.now());
  return !paidActive;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const s3Key = searchParams.get("k");

  if (!s3Key) {
    return NextResponse.json({ error: "missing_key" }, { status: 400 });
  }

  // Hard paywall boundary (I-1, FAIL CLOSED): the blur decision is driven by
  // the ASSET, not the requester. If this key resolves to a generated chat
  // image MediaAsset (a private teaser), serve full-res ONLY to an
  // authenticated + paid/active requester; blur for everyone else, including
  // an unauthenticated (null-auth) requester. Ownership is NOT part of the
  // check: a free viewer must never get full-res bytes for ANY generated chat
  // photo, even one generated for another user.
  const asset = await prisma.mediaAsset.findFirst({
    where: { s3Key, kind: "image", status: "ready" },
    select: { id: true },
  });
  if (asset) {
    const userId = await getAuthUserId();
    // Full-res allowed only when authenticated AND paid/active.
    const allowFullRes = userId !== null && !(await isFreeUser(userId));
    if (!allowFullRes) {
      // Serve blurred bytes inline. blurredDataUri returns a safe fallback on error.
      const dataUri = await blurredDataUri(s3Key);
      // Extract the base64 payload and content type from the data URI so we can
      // serve it as a proper image response (not a redirect to a data: URL, which
      // some clients/CSP setups would reject).
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const contentType = match[1] ?? "image/webp";
        const buf = Buffer.from(match[2] ?? "", "base64");
        return new Response(buf, {
          status: 200,
          headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
        });
      }
      // Fallback: return the data URI as-is (client handles it).
      return new Response(dataUri, {
        status: 200,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }
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
