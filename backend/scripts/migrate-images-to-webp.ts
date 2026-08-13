/*
 * One-time migration: convert every PNG/JPEG image in S3 to WebP AND update
 * every database reference to point at the new .webp key. This shrinks payloads
 * and speeds up load times.
 *
 * It updates all three places a raw S3 image key can live:
 *   - CharacterMedia.url            (gallery + primary/avatar images)
 *   - MediaAsset.s3Key              (generated chat/media assets)
 *   - AppearanceSheet.referenceImageKeys[]  (character reference faces)
 *
 * Only bare S3 keys are touched. Absolute http(s) URLs and local /public paths
 * (e.g. /personas/x.webp) are left untouched. Keys already ending in .webp are
 * skipped, so the script is safe to re-run (idempotent).
 *
 * Bucket routing mirrors the app: keys starting with "images/" live in
 * POPPY_S3_BUCKET_GENERATED, everything else in S3_BUCKET. If a key is not in
 * its expected bucket, the other bucket is probed as a fallback.
 *
 * Usage (from the backend/ directory):
 *   npx tsx scripts/migrate-images-to-webp.ts --dry-run      # preview only
 *   npx tsx scripts/migrate-images-to-webp.ts                # convert + update DB, keep originals
 *   npx tsx scripts/migrate-images-to-webp.ts --delete-original   # also delete the old PNGs
 *
 * Requires AWS creds + S3_BUCKET + POPPY_S3_BUCKET_GENERATED + DATABASE_URL,
 * which are read from backend/.env automatically.
 */

import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

// --- Minimal .env loader (no dependency). Runs before the Prisma singleton is
// dynamically imported below so DATABASE_URL is populated in time. ---
function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(path.resolve(__dirname, "../.env"));

const DRY_RUN = process.argv.includes("--dry-run");
const DELETE_ORIGINAL = process.argv.includes("--delete-original");

const REGION = process.env.AWS_REGION ?? "eu-north-1";
const GENERATED_BUCKET = process.env.POPPY_S3_BUCKET_GENERATED ?? "";
const MEDIA_BUCKET = process.env.S3_BUCKET ?? "";

const s3 = new S3Client({ region: REGION });

const CONVERTIBLE = /\.(png|jpe?g)$/i;

// A bare S3 key we should convert: not an absolute URL, not a public path, and
// a raster extension we can transcode.
function isConvertibleKey(value: string | null | undefined): value is string {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (value.startsWith("/")) return false;
  return CONVERTIBLE.test(value);
}

function toWebpKey(key: string): string {
  return key.replace(CONVERTIBLE, ".webp");
}

function preferredBucket(key: string): string {
  return key.startsWith("images/") ? GENERATED_BUCKET : MEDIA_BUCKET;
}

async function getObject(bucket: string, key: string): Promise<Buffer | null> {
  if (!bucket) return null;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = obj.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) return null;
    return Buffer.from(await body.transformToByteArray());
  } catch {
    return null;
  }
}

// Find the bucket that actually holds `key`, preferring the routed one.
async function resolveBucketAndBytes(
  key: string,
): Promise<{ bucket: string; bytes: Buffer } | null> {
  const primary = preferredBucket(key);
  const order = primary === GENERATED_BUCKET ? [GENERATED_BUCKET, MEDIA_BUCKET] : [MEDIA_BUCKET, GENERATED_BUCKET];
  for (const bucket of order) {
    if (!bucket) continue;
    const bytes = await getObject(bucket, key);
    if (bytes) return { bucket, bytes };
  }
  return null;
}

interface Result {
  key: string;
  webpKey: string;
  bucket: string;
  originalBytes: number;
  webpBytes: number;
  status: "converted" | "skipped-exists" | "missing" | "error";
  error?: string;
}

// Converts one key to webp in S3. Returns the mapping so DB rows can be updated.
// Caches by key so a key referenced by multiple rows is only converted once.
const conversionCache = new Map<string, Result>();

async function convertKey(key: string): Promise<Result> {
  const cached = conversionCache.get(key);
  if (cached) return cached;

  const webpKey = toWebpKey(key);
  let result: Result;

  try {
    // If the webp already exists in the expected bucket, treat as done.
    const bucket = preferredBucket(key);
    const existing = await getObject(bucket, webpKey);
    if (existing) {
      result = { key, webpKey, bucket, originalBytes: 0, webpBytes: existing.length, status: "skipped-exists" };
      conversionCache.set(key, result);
      return result;
    }

    const found = await resolveBucketAndBytes(key);
    if (!found) {
      result = { key, webpKey, bucket, originalBytes: 0, webpBytes: 0, status: "missing" };
      conversionCache.set(key, result);
      return result;
    }

    const webpBuffer = await sharp(found.bytes).webp({ quality: 85, effort: 4 }).toBuffer();

    if (!DRY_RUN) {
      await s3.send(
        new PutObjectCommand({
          Bucket: found.bucket,
          Key: webpKey,
          Body: webpBuffer,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      if (DELETE_ORIGINAL && webpKey !== key) {
        await s3.send(new DeleteObjectCommand({ Bucket: found.bucket, Key: key }));
      }
    }

    result = {
      key,
      webpKey,
      bucket: found.bucket,
      originalBytes: found.bytes.length,
      webpBytes: webpBuffer.length,
      status: "converted",
    };
  } catch (err) {
    result = {
      key,
      webpKey,
      bucket: preferredBucket(key),
      originalBytes: 0,
      webpBytes: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  conversionCache.set(key, result);
  return result;
}

async function main(): Promise<void> {
  if (!GENERATED_BUCKET && !MEDIA_BUCKET) {
    console.error("ERROR: neither POPPY_S3_BUCKET_GENERATED nor S3_BUCKET is set.");
    process.exit(1);
  }

  // Prisma is imported dynamically AFTER loadEnv so it sees DATABASE_URL.
  const { prisma } = await import("@buttercupp/database");

  console.log(
    `Mode: ${DRY_RUN ? "DRY RUN (no writes)" : DELETE_ORIGINAL ? "CONVERT + DELETE ORIGINALS" : "CONVERT (keep originals)"}`,
  );
  console.log(`Buckets: generated=${GENERATED_BUCKET || "(unset)"} media=${MEDIA_BUCKET || "(unset)"}\n`);

  // ---- 1. Gather every convertible key from all three sources ----
  const [charMedia, mediaAssets, sheets] = await Promise.all([
    prisma.characterMedia.findMany({ select: { id: true, url: true } }),
    prisma.mediaAsset.findMany({ select: { id: true, s3Key: true } }),
    prisma.appearanceSheet.findMany({ select: { id: true, referenceImageKeys: true } }),
  ]);

  const keys = new Set<string>();
  for (const m of charMedia) if (isConvertibleKey(m.url)) keys.add(m.url);
  for (const a of mediaAssets) if (isConvertibleKey(a.s3Key)) keys.add(a.s3Key);
  for (const sh of sheets) for (const k of sh.referenceImageKeys) if (isConvertibleKey(k)) keys.add(k);

  console.log(`Found ${keys.size} unique PNG/JPEG key(s) to process.\n`);

  // ---- 2. Convert each unique key in S3 ----
  let converted = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;
  let savedBytes = 0;

  for (const key of keys) {
    const r = await convertKey(key);
    const tag = DRY_RUN ? "[DRY] " : "";
    if (r.status === "converted") {
      converted += 1;
      savedBytes += Math.max(0, r.originalBytes - r.webpBytes);
      const pct = r.originalBytes > 0 ? Math.round((1 - r.webpBytes / r.originalBytes) * 100) : 0;
      console.log(`${tag}OK    ${key} -> ${r.webpKey}  (${Math.round(r.originalBytes / 1024)}KB -> ${Math.round(r.webpBytes / 1024)}KB, -${pct}%)`);
    } else if (r.status === "skipped-exists") {
      skipped += 1;
      console.log(`${tag}SKIP  ${key}  (webp already exists)`);
    } else if (r.status === "missing") {
      missing += 1;
      console.log(`${tag}MISS  ${key}  (not found in any bucket)`);
    } else {
      failed += 1;
      console.log(`${tag}FAIL  ${key}  (${r.error})`);
    }
  }

  // A key maps to its new webp key only if we have (or already had) the webp.
  const mapped = (value: string): string | null => {
    const r = conversionCache.get(value);
    if (!r) return null;
    if (r.status === "converted" || r.status === "skipped-exists") return r.webpKey;
    return null;
  };

  // ---- 3. Update every DB reference to the new key ----
  let rowsUpdated = 0;

  if (!DRY_RUN) {
    // CharacterMedia.url
    for (const m of charMedia) {
      if (!isConvertibleKey(m.url)) continue;
      const next = mapped(m.url);
      if (!next || next === m.url) continue;
      await prisma.characterMedia.update({ where: { id: m.id }, data: { url: next } });
      rowsUpdated += 1;
    }
    // MediaAsset.s3Key
    for (const a of mediaAssets) {
      if (!isConvertibleKey(a.s3Key)) continue;
      const next = mapped(a.s3Key as string);
      if (!next || next === a.s3Key) continue;
      await prisma.mediaAsset.update({ where: { id: a.id }, data: { s3Key: next } });
      rowsUpdated += 1;
    }
    // AppearanceSheet.referenceImageKeys[]
    for (const sh of sheets) {
      let changed = false;
      const nextKeys = sh.referenceImageKeys.map((k) => {
        if (!isConvertibleKey(k)) return k;
        const next = mapped(k);
        if (next && next !== k) {
          changed = true;
          return next;
        }
        return k;
      });
      if (changed) {
        await prisma.appearanceSheet.update({ where: { id: sh.id }, data: { referenceImageKeys: nextKeys } });
        rowsUpdated += 1;
      }
    }
  } else {
    // Dry run: count what WOULD be updated.
    for (const m of charMedia) if (isConvertibleKey(m.url) && mapped(m.url)) rowsUpdated += 1;
    for (const a of mediaAssets) if (isConvertibleKey(a.s3Key) && mapped(a.s3Key as string)) rowsUpdated += 1;
    for (const sh of sheets) if (sh.referenceImageKeys.some((k) => isConvertibleKey(k) && mapped(k))) rowsUpdated += 1;
  }

  // ---- 4. Manifest + summary ----
  const manifestPath = path.resolve(__dirname, "webp-migration-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      { mode: DRY_RUN ? "dry-run" : DELETE_ORIGINAL ? "convert+delete" : "convert", at: new Date().toISOString(), results: Array.from(conversionCache.values()) },
      null,
      2,
    ),
  );

  console.log("\n==================== SUMMARY ====================");
  console.log(`S3 converted:      ${converted}`);
  console.log(`S3 skipped (webp): ${skipped}`);
  console.log(`S3 missing:        ${missing}`);
  console.log(`S3 failed:         ${failed}`);
  console.log(`DB rows ${DRY_RUN ? "to update" : "updated"}: ${rowsUpdated}`);
  console.log(`Approx bytes saved: ${(savedBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Manifest: ${manifestPath}`);
  if (DRY_RUN) console.log("\nDRY RUN complete. Re-run without --dry-run to apply.");

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
