// S3 upload + signed-URL retrieval. Uses AWS SDK v3 with an optional
// S3_ENDPOINT override so MinIO/LocalStack works in dev. Signed URLs prefer
// CloudFront (production) and fall back to S3 presigned URLs when the
// CloudFront envs are absent.

import crypto from "node:crypto";

interface UploadContext {
  userId: string;
  kind: string;
  contentType: string;
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mp4")) return "mp4";
  return "bin";
}

type S3Deps = {
  client: unknown;
  PutObjectCommand: unknown;
  GetObjectCommand: unknown;
  getSignedUrl: (client: unknown, cmd: unknown, opts: { expiresIn: number }) => Promise<string>;
  getCloudFrontSignedUrl?: (opts: {
    url: string;
    keyPairId: string;
    privateKey: string;
    dateLessThan: string;
  }) => string;
};

let _deps: S3Deps | null = null;

function loadS3(): S3Deps | null {
  if (_deps) return _deps;
  try {
     
    const s3 = require("@aws-sdk/client-s3");
     
    const presigner = require("@aws-sdk/s3-request-presigner");
    let cloudfront: unknown = null;
    try {
       
      cloudfront = require("@aws-sdk/cloudfront-signer");
    } catch {
      // optional; local dev uses S3 presigned URLs
    }
    const client = new s3.S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      ...(process.env.S3_ENDPOINT
        ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
    });
    _deps = {
      client,
      PutObjectCommand: s3.PutObjectCommand,
      GetObjectCommand: s3.GetObjectCommand,
      getSignedUrl: presigner.getSignedUrl,
      getCloudFrontSignedUrl: (cloudfront as { getSignedUrl?: S3Deps["getCloudFrontSignedUrl"] } | null)
        ?.getSignedUrl,
    };
    return _deps;
  } catch {
    return null;
  }
}

export async function uploadMedia(buffer: Buffer, ctx: UploadContext): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured");
  const deps = loadS3();
  if (!deps) throw new Error("aws sdk not installed");

  const ext = extensionFor(ctx.contentType);
  const key = `media/${ctx.userId}/${ctx.kind}/${crypto.randomUUID()}.${ext}`;
  const PutCtor = deps.PutObjectCommand as new (args: Record<string, unknown>) => unknown;
  const cmd = new PutCtor({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: ctx.contentType,
  });
  const send = (deps.client as { send: (c: unknown) => Promise<unknown> }).send.bind(deps.client);
  await send(cmd);
  return key;
}

// 15-minute TTL by default; safe for a chat UI that renders a media asset
// once. Callers can override for long-form embeds.
export async function getSignedUrl(s3Key: string, ttlSeconds = 15 * 60): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured");
  const deps = loadS3();
  if (!deps) throw new Error("aws sdk not installed");

  const cfBase = process.env.CLOUDFRONT_URL;
  const cfKeyId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const cfKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  if (cfBase && cfKeyId && cfKey && deps.getCloudFrontSignedUrl) {
    const url = `${cfBase.replace(/\/$/, "")}/${s3Key}`;
    return deps.getCloudFrontSignedUrl({
      url,
      keyPairId: cfKeyId,
      privateKey: cfKey.replace(/\\n/g, "\n"),
      dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  }

  const GetCtor = deps.GetObjectCommand as new (args: Record<string, unknown>) => unknown;
  const cmd = new GetCtor({ Bucket: bucket, Key: s3Key });
  return deps.getSignedUrl(deps.client, cmd, { expiresIn: ttlSeconds });
}
