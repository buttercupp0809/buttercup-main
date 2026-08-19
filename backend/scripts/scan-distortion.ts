/*
 * Feature E, step 1: scan persona images with Claude Haiku vision and produce a
 * REPORT. The scan NEVER deletes. Deletion is a separate, gated script that
 * only runs against an approved report (see delete-flagged-media.ts).
 *
 * Input: Plans/inference-aws/persona-media-manifest.json (written by Feature D).
 *        Manifest shape:
 *          {
 *            characters: {
 *              [characterId]: [
 *                { variant, pngPath, s3Key, characterMediaId }
 *              ]
 *            }
 *          }
 *        s3Key is the WebP key. pngPath is a LOCAL PNG path from the generator.
 *        If a source PNG has also been uploaded to S3 as `images/personas/{id}/p{v}.png`,
 *        it is picked up as a paired pngKey by convention (WebP key with the
 *        extension swapped). Deletion pairs both when both exist.
 *
 * Output:
 *   - Plans/inference-aws/distortion-report.json (machine-readable)
 *   - Plans/inference-aws/distortion-report.txt  (human summary)
 *
 * Guardrails:
 *   - Report first; the scan never deletes.
 *   - LIMIT env caps how many items are scanned (cheap first pass).
 *   - Parse failures are `needs_review`, never flagged.
 *   - Confidence threshold via DISTORTION_MIN_CONFIDENCE (default 0.75).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MODELS } from "../src/llm/constants";
import { bucketForKey } from "../src/media/storage";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ManifestItem {
  variant: number;
  pngPath: string;
  s3Key: string;
  characterMediaId: string | null;
}

export interface ManifestFile {
  at?: string;
  mode?: string;
  target?: string;
  summary?: unknown;
  characters: Record<string, ManifestItem[]>;
}

export interface ScanItem {
  characterId: string;
  variant: number;
  webpKey: string;
  pngKey: string | null;
  characterMediaId: string | null;
}

export interface HaikuJudgment {
  distorted: boolean;
  blurry: boolean;
  anatomy_ok: boolean;
  confidence: number;
  reason: string;
}

export interface FlaggedItem extends ScanItem {
  judgment: HaikuJudgment;
  confidence: number;
  reason: string;
  mediaAssetId?: string | null;
}

export interface NeedsReviewItem extends ScanItem {
  rawResponse: string;
  errorMessage: string;
}

export interface ScanReport {
  at: string;
  target: string;
  model: string;
  minConfidence: number;
  totals: {
    scanned: number;
    flagged: number;
    clean: number;
    needsReview: number;
    errors: number;
  };
  flagged: FlaggedItem[];
  needsReview: NeedsReviewItem[];
  errors: Array<{ item: ScanItem; error: string }>;
}

export interface RunOptions {
  manifestPath: string;
  reportJsonPath: string;
  reportTxtPath: string;
  target: string;
  minConfidence: number;
  concurrency: number;
  limit: number | null;
  onlyCharacters: Set<string> | null;
  probePngKey: boolean;
  maxRetries: number;
}

export interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
}

export interface AnthropicMessageArgs {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
    >;
  }>;
}

export interface AnthropicVisionClient {
  messages: {
    create: (args: AnthropicMessageArgs) => Promise<AnthropicMessageResponse>;
  };
}

export interface S3Fetcher {
  // Fetch bytes for the given s3 key. Return null if the object does not exist.
  fetch: (bucket: string, key: string) => Promise<Buffer | null>;
}

export interface FsOps {
  readFile: (p: string) => Buffer;
  writeFile: (p: string, contents: string) => void;
}

export interface Logger {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

export interface RunDeps {
  anthropic: AnthropicVisionClient;
  s3: S3Fetcher;
  fs: FsOps;
  logger: Logger;
}

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

const JudgmentSchema = z.object({
  distorted: z.boolean(),
  blurry: z.boolean(),
  anatomy_ok: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
});

// Claude sometimes wraps JSON in a ```json ...``` fence or adds a leading
// sentence. Strip the fence and grab the first {...} block before parsing.
export function extractJsonBlob(raw: string): string | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseHaikuResponse(raw: string): HaikuJudgment | null {
  const blob = extractJsonBlob(raw);
  if (!blob) return null;
  try {
    const obj = JSON.parse(blob) as unknown;
    const parsed = JudgmentSchema.safeParse(obj);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function shouldFlag(j: HaikuJudgment, minConfidence: number): boolean {
  const bad = j.distorted || j.blurry || !j.anatomy_ok;
  return bad && j.confidence >= minConfidence;
}

// Probe convention: same directory, same basename, .png extension.
export function inferPngKey(webpKey: string): string | null {
  if (!webpKey.toLowerCase().endsWith(".webp")) return null;
  return webpKey.slice(0, -".webp".length) + ".png";
}

export function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

// Sniff the actual image type from the first few bytes of the buffer. Anthropic
// rejects the request if the declared media_type disagrees with the payload, so
// we trust bytes over the S3 key's extension (Feature D can upload PNG bytes
// under a `.webp` key when sharp is not installed).
export type SniffedImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImageMediaType(buf: Buffer): SniffedImageType | null {
  if (!buf || buf.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG SOI: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function flattenManifest(m: ManifestFile): ScanItem[] {
  const out: ScanItem[] = [];
  for (const [characterId, rows] of Object.entries(m.characters ?? {})) {
    for (const row of rows) {
      out.push({
        characterId,
        variant: row.variant,
        webpKey: row.s3Key,
        pngKey: null,
        characterMediaId: row.characterMediaId,
      });
    }
  }
  return out;
}

export function parseOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  manifestPath: string,
  reportJsonPath: string,
  reportTxtPath: string,
): RunOptions {
  const minConfidence = (() => {
    const raw = env.DISTORTION_MIN_CONFIDENCE;
    if (!raw) return 0.75;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0.75;
  })();
  const concurrency = (() => {
    const raw = env.SCAN_CONCURRENCY;
    if (!raw) return 4;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 4;
  })();
  const limit = env.LIMIT ? Math.max(0, parseInt(env.LIMIT, 10) || 0) : null;
  const only = env.ONLY
    ? new Set(env.ONLY.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  return {
    manifestPath,
    reportJsonPath,
    reportTxtPath,
    target: env.TARGET ?? "local",
    minConfidence,
    concurrency,
    limit,
    onlyCharacters: only,
    probePngKey: env.PROBE_PNG_KEY !== "0",
    maxRetries: 2,
  };
}

const HAIKU_PROMPT = [
  "You are an image quality reviewer for a persona gallery.",
  "Look at the image. Judge it on three axes:",
  "1) distorted: obvious warping, melted geometry, extra or missing limbs, broken faces.",
  "2) blurry: low sharpness, out-of-focus, smeared textures (not shallow depth of field).",
  "3) anatomy_ok: proportions and features look plausibly human.",
  "",
  "Return STRICT JSON, no prose, no markdown fence, matching:",
  '{"distorted": boolean, "blurry": boolean, "anatomy_ok": boolean, "confidence": number between 0 and 1, "reason": short string}',
].join("\n");

// -----------------------------------------------------------------------------
// Core runner
// -----------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, err: unknown) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      onRetry(attempt + 1, err);
      const backoffMs = 250 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function scanOne(
  item: ScanItem,
  opts: RunOptions,
  deps: RunDeps,
): Promise<
  | { kind: "flagged"; entry: FlaggedItem }
  | { kind: "clean"; entry: ScanItem; judgment: HaikuJudgment }
  | { kind: "needs_review"; entry: NeedsReviewItem }
  | { kind: "error"; entry: ScanItem; error: string }
> {
  const bucket = bucketForKey(item.webpKey);
  if (!bucket) {
    return { kind: "error", entry: item, error: "no bucket resolved for key" };
  }
  let bytes: Buffer | null = null;
  try {
    bytes = await deps.s3.fetch(bucket, item.webpKey);
  } catch (err) {
    return {
      kind: "error",
      entry: item,
      error: `s3 fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!bytes) {
    return { kind: "error", entry: item, error: "s3 object missing" };
  }

  // Probe for a paired PNG in the same "directory". This is best-effort so a
  // report can list both keys even if only the WebP was scanned.
  let pngKey: string | null = item.pngKey;
  if (!pngKey && opts.probePngKey) {
    const candidate = inferPngKey(item.webpKey);
    if (candidate) {
      try {
        const pngBucket = bucketForKey(candidate);
        const probe = await deps.s3.fetch(pngBucket, candidate);
        if (probe) pngKey = candidate;
      } catch {
        // probe is best-effort; ignore
      }
    }
  }
  const enrichedItem: ScanItem = { ...item, pngKey };

  const sniffed = sniffImageMediaType(bytes);
  const keyType = contentTypeForKey(item.webpKey);
  deps.logger.info(
    `[scan-distortion] fetched ${item.webpKey} bytes=${bytes.length} sniffed=${sniffed ?? "unknown"} keyType=${keyType}`,
  );
  if (!sniffed) {
    return {
      kind: "error",
      entry: enrichedItem,
      error: "unsupported image magic bytes",
    };
  }
  if (sniffed !== keyType) {
    deps.logger.warn(
      `[scan-distortion] media type mismatch for ${item.webpKey}: key implies ${keyType} but bytes are ${sniffed}`,
    );
  }
  const base64 = bytes.toString("base64");
  const mediaType = sniffed;

  let raw = "";
  try {
    const response = await withRetry(
      () =>
        deps.anthropic.messages.create({
          model: MODELS.ANTHROPIC_VISION,
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64 },
                },
                { type: "text", text: HAIKU_PROMPT },
              ],
            },
          ],
        }),
      opts.maxRetries,
      (attempt, err) => {
        deps.logger.warn(
          `[scan-distortion] retry ${attempt} for ${item.webpKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
    raw = response.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
  } catch (err) {
    return {
      kind: "error",
      entry: enrichedItem,
      error: `anthropic call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const judgment = parseHaikuResponse(raw);
  if (!judgment) {
    return {
      kind: "needs_review",
      entry: {
        ...enrichedItem,
        rawResponse: raw.slice(0, 2000),
        errorMessage: "response did not parse as strict JSON",
      },
    };
  }
  if (shouldFlag(judgment, opts.minConfidence)) {
    return {
      kind: "flagged",
      entry: {
        ...enrichedItem,
        judgment,
        confidence: judgment.confidence,
        reason: judgment.reason,
      },
    };
  }
  return { kind: "clean", entry: enrichedItem, judgment };
}

// Simple concurrency-limited map.
async function pmapLimit<T, U>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function renderTextReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push("Persona distortion scan report");
  lines.push(`at: ${report.at}`);
  lines.push(`target: ${report.target}`);
  lines.push(`model: ${report.model}`);
  lines.push(`minConfidence: ${report.minConfidence}`);
  lines.push("");
  lines.push(
    `totals: scanned=${report.totals.scanned} flagged=${report.totals.flagged} clean=${report.totals.clean} needsReview=${report.totals.needsReview} errors=${report.totals.errors}`,
  );
  lines.push("");
  lines.push("Flagged items:");
  if (report.flagged.length === 0) lines.push("  (none)");
  for (const f of report.flagged) {
    lines.push(
      `  - char=${f.characterId} p${f.variant} webp=${f.webpKey} png=${f.pngKey ?? "(local only)"} conf=${f.confidence.toFixed(2)} reason=${f.reason}`,
    );
    lines.push(
      `      characterMediaId=${f.characterMediaId ?? "(none)"} distorted=${f.judgment.distorted} blurry=${f.judgment.blurry} anatomy_ok=${f.judgment.anatomy_ok}`,
    );
  }
  lines.push("");
  lines.push("Needs review (parse failure):");
  if (report.needsReview.length === 0) lines.push("  (none)");
  for (const n of report.needsReview) {
    lines.push(`  - char=${n.characterId} p${n.variant} webp=${n.webpKey} reason=${n.errorMessage}`);
  }
  lines.push("");
  lines.push("Errors:");
  if (report.errors.length === 0) lines.push("  (none)");
  for (const e of report.errors) {
    lines.push(`  - char=${e.item.characterId} p${e.item.variant} webp=${e.item.webpKey} error=${e.error}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function runScanDistortion(opts: RunOptions, deps: RunDeps): Promise<ScanReport> {
  const raw = deps.fs.readFile(opts.manifestPath).toString("utf8");
  const parsed = JSON.parse(raw) as ManifestFile;
  let items = flattenManifest(parsed);
  if (opts.onlyCharacters) {
    items = items.filter((it) => opts.onlyCharacters!.has(it.characterId));
  }
  if (opts.limit !== null) {
    items = items.slice(0, opts.limit);
  }

  deps.logger.info(
    `[scan-distortion] items=${items.length} concurrency=${opts.concurrency} minConfidence=${opts.minConfidence} model=${MODELS.ANTHROPIC_VISION}`,
  );

  const results = await pmapLimit(items, opts.concurrency, (it) => scanOne(it, opts, deps));

  const flagged: FlaggedItem[] = [];
  const needsReview: NeedsReviewItem[] = [];
  const errors: Array<{ item: ScanItem; error: string }> = [];
  let clean = 0;
  for (const r of results) {
    if (r.kind === "flagged") flagged.push(r.entry);
    else if (r.kind === "needs_review") needsReview.push(r.entry);
    else if (r.kind === "error") errors.push({ item: r.entry, error: r.error });
    else clean += 1;
  }

  const report: ScanReport = {
    at: new Date().toISOString(),
    target: opts.target,
    model: MODELS.ANTHROPIC_VISION,
    minConfidence: opts.minConfidence,
    totals: {
      scanned: items.length,
      flagged: flagged.length,
      clean,
      needsReview: needsReview.length,
      errors: errors.length,
    },
    flagged,
    needsReview,
    errors,
  };

  deps.fs.writeFile(opts.reportJsonPath, JSON.stringify(report, null, 2));
  deps.fs.writeFile(opts.reportTxtPath, renderTextReport(report));
  deps.logger.info(
    `[scan-distortion] wrote ${opts.reportJsonPath} and ${opts.reportTxtPath} (flagged=${flagged.length}, needsReview=${needsReview.length}, errors=${errors.length})`,
  );
  return report;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

async function cli(): Promise<void> {
  const dotenv = await import("dotenv").catch(() => null);
  if (dotenv) dotenv.config({ path: path.resolve(__dirname, "../.env") });

  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifestPath = path.join(repoRoot, "Plans", "inference-aws", "persona-media-manifest.json");
  const reportJsonPath = path.join(repoRoot, "Plans", "inference-aws", "distortion-report.json");
  const reportTxtPath = path.join(repoRoot, "Plans", "inference-aws", "distortion-report.txt");
  const opts = parseOptionsFromEnv(process.env, manifestPath, reportJsonPath, reportTxtPath);

  const { getAnthropicClient } = await import("../src/llm/provider");
  const anthropicRaw = getAnthropicClient();
  if (!anthropicRaw) {
    throw new Error(
      "[scan-distortion] Anthropic client unavailable. Set ANTHROPIC_API_KEY and install @anthropic-ai/sdk.",
    );
  }
  const anthropic: AnthropicVisionClient = {
    messages: {
      create: (args) =>
        (anthropicRaw.messages.create(args as unknown as Record<string, unknown>) as Promise<AnthropicMessageResponse>),
    },
  };

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3Client = new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
  const s3: S3Fetcher = {
    fetch: async (bucket, key) => {
      try {
        const out = (await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
          Body?: { transformToByteArray?: () => Promise<Uint8Array> };
        };
        const body = out.Body;
        if (!body?.transformToByteArray) return null;
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        const name = (err as { name?: string; Code?: string }).name ?? (err as { Code?: string }).Code;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw err;
      }
    },
  };

  const fs: FsOps = {
    readFile: (p) => readFileSync(p),
    writeFile: (p, contents) => writeFileSync(p, contents),
  };
  const logger: Logger = {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };

  await runScanDistortion(opts, { anthropic, s3, fs, logger });
}

if (require.main === module) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
