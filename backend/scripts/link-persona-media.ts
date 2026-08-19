/*
 * Feature D: link persona images to S3 and CharacterMedia.
 *
 * For each persona number N under Plans/inference-aws/persona-output/N_p{1..5}:
 *   - keep variants p1..p4, drop p5 (the fifth). p5 dirs are MOVED (not deleted)
 *     to persona-output/_trashed/ under APPLY, so the change is reversible.
 *   - resolve N to the Character row(s) whose seed image is /personas/N.webp
 *     (same mapping the existing import script uses).
 *   - for each (character, kept variant): convert the PNG to WebP, upload to a
 *     deterministic S3 key `images/personas/{characterId}/p{v}.webp` (routes to
 *     POPPY_S3_BUCKET_GENERATED via bucketForKey), and upsert a CharacterMedia
 *     row keyed by (characterId, url). isPrimary/isDisplay/hidden are left at
 *     false: the existing hero keeps its flags, nothing is promoted.
 *   - assert every processed character already has exactly one isDisplay=true
 *     row; if zero, warn and skip promotion (never silently promote a variant).
 *   - write Plans/inference-aws/persona-media-manifest.json for Feature E.
 *
 * Guardrails:
 *   - DRY_RUN=1 (default) performs zero prisma writes and zero S3 puts.
 *   - APPLY=1 required to write. Only intended for a LOCAL DATABASE_URL and a
 *     local MinIO/S3 target. Prod apply is a human step.
 *   - TARGET=local (default). The script never edits DATABASE_URL; it only
 *     reads it, matching the rest of the backend.
 *   - LIMIT=<n> caps how many persona numbers to process; ONLY=<id[,id...]>
 *     restricts to a subset.
 *
 * Run (from backend/):
 *   DRY_RUN=1 npx tsx scripts/link-persona-media.ts
 *   APPLY=1 TARGET=local npx tsx scripts/link-persona-media.ts
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bucketForKey } from "../src/media/storage";
import { toWebP } from "../src/media/image/convert";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface VariantEntry {
  variant: number;
  dir: string;
  pngPath: string;
}

export interface PersonaGroup {
  personaNumber: number;
  entries: VariantEntry[];
  fifth: VariantEntry | null;
}

export interface ManifestRow {
  variant: number;
  pngPath: string;
  s3Key: string;
  characterMediaId: string | null;
}

export interface RunOptions {
  rootDir: string;
  dryRun: boolean;
  apply: boolean;
  target: string;
  limit: number | null;
  only: Set<number> | null;
  createMediaAsset: boolean;
  systemUserId: string | null;
  manifestPath: string;
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

// The minimum prisma surface the script needs. Keeping this narrow makes tests
// cheap: they only stub these methods.
export interface PrismaLike {
  character: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
  };
  characterMedia: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      distinct?: string[];
    }) => Promise<Array<Record<string, unknown>>>;
    findFirst: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<Record<string, unknown> | null>;
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  mediaAsset: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
}

export interface S3Putter {
  put: (bucket: string, key: string, body: Buffer, contentType: string) => Promise<void>;
}

export interface FsOps {
  readFile: (p: string) => Buffer;
  moveDir: (from: string, to: string) => void;
  writeFile: (p: string, contents: string) => void;
}

export interface RunDeps {
  prisma: PrismaLike;
  s3: S3Putter;
  fs: FsOps;
  toWebP: (buf: Buffer) => Promise<{ buffer: Buffer; contentType: "image/webp" | "image/png" | "image/jpeg" }>;
  logger: Logger;
}

export interface RunSummary {
  charactersProcessed: number;
  variantsUploaded: number;
  rowsUpserted: number;
  p5DirsTrashed: number;
  missingHero: string[];
  manifest: Record<string, ManifestRow[]>;
}

// -----------------------------------------------------------------------------
// Pure helpers (tested directly)
// -----------------------------------------------------------------------------

const FOLDER_RE = /^(\d+)_p(\d+)$/;

// Group persona-output/N_p{v} folders by persona number. Only folders that
// actually contain the expected variant PNG are included; missing files are
// silently dropped so callers do not need to defend against them.
export function scanPersonaGroups(rootDir: string, readdir: (p: string) => string[] = readdirSync): PersonaGroup[] {
  if (!existsSync(rootDir)) return [];
  const byPersona = new Map<number, VariantEntry[]>();
  for (const entry of readdir(rootDir).sort()) {
    const match = entry.match(FOLDER_RE);
    if (!match) continue;
    const personaNumber = parseInt(match[1], 10);
    const variant = parseInt(match[2], 10);
    const dir = path.join(rootDir, entry);
    // Every N_p{v} folder ships one PNG. The generator names it after the
    // manifest's first variant (variant-p1-v1.png in the current run), NOT
    // after the folder's variant number, so we resolve it by scanning for a
    // .png rather than assuming a filename.
    const png = readdir(dir).find((f) => f.toLowerCase().endsWith(".png"));
    if (!png) continue;
    const pngPath = path.join(dir, png);
    const list = byPersona.get(personaNumber) ?? [];
    list.push({ variant, dir, pngPath });
    byPersona.set(personaNumber, list);
  }

  const groups: PersonaGroup[] = [];
  for (const [personaNumber, entries] of byPersona.entries()) {
    entries.sort((a, b) => a.variant - b.variant);
    const fifth = entries.find((e) => e.variant === 5) ?? null;
    groups.push({
      personaNumber,
      entries: entries.filter((e) => e.variant <= 4),
      fifth,
    });
  }
  groups.sort((a, b) => a.personaNumber - b.personaNumber);
  return groups;
}

// Keep p1..p4, drop p5 (or higher). Fewer than 5 dirs is fine: we just keep
// whatever is <= 4.
export function selectKeptVariants(entries: VariantEntry[]): VariantEntry[] {
  return entries.filter((e) => e.variant >= 1 && e.variant <= 4).sort((a, b) => a.variant - b.variant);
}

// Deterministic S3 key. `images/` prefix routes to POPPY_S3_BUCKET_GENERATED
// via bucketForKey, matching the rest of the storage layer.
export function buildPersonaKey(characterId: string, variant: number): string {
  return `images/personas/${characterId}/p${variant}.webp`;
}

// -----------------------------------------------------------------------------
// Env parsing
// -----------------------------------------------------------------------------

export function parseOptionsFromEnv(env: NodeJS.ProcessEnv, rootDir: string, manifestPath: string): RunOptions {
  const apply = env.APPLY === "1";
  const dryRunRaw = env.DRY_RUN;
  const dryRun = dryRunRaw === undefined ? !apply : dryRunRaw === "1";
  const limitRaw = env.LIMIT;
  const limit = limitRaw && limitRaw.length > 0 ? Math.max(0, parseInt(limitRaw, 10) || 0) : null;
  const onlyRaw = env.ONLY;
  const only = onlyRaw
    ? new Set(
        onlyRaw
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0),
      )
    : null;
  return {
    rootDir,
    dryRun,
    apply,
    target: env.TARGET ?? "local",
    limit,
    only,
    createMediaAsset: env.CREATE_MEDIA_ASSET === "1",
    systemUserId: env.SYSTEM_USER_ID ?? null,
    manifestPath,
  };
}

// -----------------------------------------------------------------------------
// Core run function (dependency-injected, testable)
// -----------------------------------------------------------------------------

export async function runLinkPersonaMedia(opts: RunOptions, deps: RunDeps): Promise<RunSummary> {
  const { prisma, s3, fs, logger } = deps;
  const summary: RunSummary = {
    charactersProcessed: 0,
    variantsUploaded: 0,
    rowsUpserted: 0,
    p5DirsTrashed: 0,
    missingHero: [],
    manifest: {},
  };

  const trashRoot = path.join(opts.rootDir, "_trashed");
  let groups = scanPersonaGroups(opts.rootDir);
  if (opts.only) {
    groups = groups.filter((g) => opts.only!.has(g.personaNumber));
  }
  if (opts.limit !== null) {
    groups = groups.slice(0, opts.limit);
  }

  logger.info(
    `[link-persona-media] target=${opts.target} dryRun=${opts.dryRun} apply=${opts.apply} groups=${groups.length}`,
  );

  for (const group of groups) {
    const kept = selectKeptVariants(group.entries);

    // ---- resolve persona number -> character rows via seed url convention ----
    const seedUrl = `/personas/${group.personaNumber}.webp`;
    const matches = await prisma.characterMedia.findMany({
      where: { url: seedUrl },
      select: { characterId: true },
      distinct: ["characterId"],
    });
    const characterIds = matches
      .map((m) => (typeof m.characterId === "string" ? m.characterId : null))
      .filter((v): v is string => Boolean(v));

    if (characterIds.length === 0) {
      logger.warn(
        `[link-persona-media] persona ${group.personaNumber}: no Character row seeded from ${seedUrl}, skipping.`,
      );
    }

    // ---- trash the p5 dir (once per persona) ----
    if (group.fifth) {
      const dst = path.join(trashRoot, path.basename(group.fifth.dir));
      if (opts.dryRun) {
        logger.info(`[link-persona-media] DRY: would trash ${group.fifth.dir} -> ${dst}`);
      } else if (opts.apply) {
        if (!existsSync(trashRoot)) mkdirSync(trashRoot, { recursive: true });
        if (!existsSync(dst)) {
          fs.moveDir(group.fifth.dir, dst);
          summary.p5DirsTrashed++;
          logger.info(`[link-persona-media] trashed ${group.fifth.dir} -> ${dst}`);
        } else {
          logger.info(`[link-persona-media] trash target already exists, skipping: ${dst}`);
        }
      }
    }

    // ---- for every mapped character, upload variants + upsert CharacterMedia ----
    for (const characterId of characterIds) {
      summary.charactersProcessed++;

      // hero invariant: exactly one isDisplay=true expected. If zero, warn and
      // do not promote any variant. If more than one, warn but proceed (the
      // script never touches display flags).
      const displayCount = await prisma.characterMedia.count({
        where: { characterId, isDisplay: true, hidden: false },
      });
      if (displayCount === 0) {
        summary.missingHero.push(characterId);
        logger.warn(
          `[link-persona-media] character ${characterId} has zero isDisplay rows; not promoting a variant. Human follow-up needed.`,
        );
      } else if (displayCount > 1) {
        logger.warn(
          `[link-persona-media] character ${characterId} has ${displayCount} isDisplay rows; script leaves this alone.`,
        );
      }

      const rows: ManifestRow[] = [];
      for (const v of kept) {
        const s3Key = buildPersonaKey(characterId, v.variant);
        const bucket = bucketForKey(s3Key);

        // Idempotency: check for an existing (characterId, url) row before any
        // upload so a re-run does not re-transcode + re-put.
        const existing = await prisma.characterMedia.findFirst({
          where: { characterId, url: s3Key },
          select: { id: true },
        });

        if (opts.dryRun) {
          logger.info(
            `[link-persona-media] DRY: char=${characterId} p${v.variant} -> s3://${bucket}/${s3Key}${existing ? " (row exists)" : ""}`,
          );
          rows.push({
            variant: v.variant,
            pngPath: v.pngPath,
            s3Key,
            characterMediaId: existing ? (existing.id as string) : null,
          });
          continue;
        }

        if (!opts.apply) {
          // Neither dryRun nor apply. Bail out so we never write silently.
          throw new Error("[link-persona-media] refusing to write without APPLY=1");
        }

        if (!existing) {
          const png = fs.readFile(v.pngPath);
          const converted = await deps.toWebP(png);
          if (!bucket) {
            throw new Error(
              "[link-persona-media] POPPY_S3_BUCKET_GENERATED (or S3_BUCKET fallback) not configured; cannot upload.",
            );
          }
          await s3.put(bucket, s3Key, converted.buffer, converted.contentType);
          summary.variantsUploaded++;
        }

        let rowId: string;
        if (existing) {
          rowId = existing.id as string;
        } else {
          const created = await prisma.characterMedia.create({
            data: {
              characterId,
              kind: "image",
              url: s3Key,
              isPrimary: false,
              isDisplay: false,
              hidden: false,
              sort: v.variant,
            },
          });
          rowId = created.id;
          summary.rowsUpserted++;

          if (opts.createMediaAsset && opts.systemUserId) {
            await prisma.mediaAsset.create({
              data: {
                userId: opts.systemUserId,
                characterId,
                kind: "image",
                s3Key,
                status: "ready",
              },
            });
          }
        }

        rows.push({ variant: v.variant, pngPath: v.pngPath, s3Key, characterMediaId: rowId });
      }

      const existingList = summary.manifest[characterId] ?? [];
      summary.manifest[characterId] = existingList.concat(rows);
    }
  }

  // ---- write output manifest ----
  const manifestPayload = {
    at: new Date().toISOString(),
    mode: opts.dryRun ? "dry-run" : "apply",
    target: opts.target,
    summary: {
      charactersProcessed: summary.charactersProcessed,
      variantsUploaded: summary.variantsUploaded,
      rowsUpserted: summary.rowsUpserted,
      p5DirsTrashed: summary.p5DirsTrashed,
      missingHero: summary.missingHero,
    },
    // characterId -> [{ variant, pngPath, s3Key, characterMediaId }]. Feature E
    // consumes this to pair PNG and WebP and to find rows to delete; keep the
    // shape stable.
    characters: summary.manifest,
  };
  fs.writeFile(opts.manifestPath, JSON.stringify(manifestPayload, null, 2));
  logger.info(`[link-persona-media] wrote manifest ${opts.manifestPath}`);

  logger.info(
    `[link-persona-media] SUMMARY charactersProcessed=${summary.charactersProcessed} variantsUploaded=${summary.variantsUploaded} rowsUpserted=${summary.rowsUpserted} p5DirsTrashed=${summary.p5DirsTrashed} missingHero=${summary.missingHero.length}`,
  );
  return summary;
}

// -----------------------------------------------------------------------------
// CLI entry (only runs when invoked directly, not when imported by tests)
// -----------------------------------------------------------------------------

async function cli(): Promise<void> {
  // Load backend/.env before importing prisma so DATABASE_URL is populated.
  const dotenv = await import("dotenv").catch(() => null);
  if (dotenv) {
    dotenv.config({ path: path.resolve(__dirname, "../.env") });
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const rootDir = path.join(repoRoot, "Plans", "inference-aws", "persona-output");
  const manifestPath = path.join(repoRoot, "Plans", "inference-aws", "persona-media-manifest.json");
  const opts = parseOptionsFromEnv(process.env, rootDir, manifestPath);

  if (opts.apply && opts.target !== "local" && opts.target !== "prod") {
    throw new Error(
      `[link-persona-media] refusing to APPLY against TARGET=${opts.target}. Only 'local' or 'prod' is allowed; prod apply is a human step.`,
    );
  }

  const { prisma } = await import("@buttercupp/database");

  // Real S3 client wired the same way the backend does (S3_ENDPOINT override
  // for MinIO, forcePathStyle required). Only loaded when needed so a dry run
  // works even without AWS creds.
  let s3Send: ((bucket: string, key: string, body: Buffer, contentType: string) => Promise<void>) | null = null;
  const putter: S3Putter = {
    put: async (bucket, key, body, contentType) => {
      if (!s3Send) {
        const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
        const client = new S3Client({
          region: process.env.AWS_REGION ?? "us-east-1",
          ...(process.env.S3_ENDPOINT
            ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
            : {}),
        });
        s3Send = async (b, k, body2, ct) => {
          await client.send(new PutObjectCommand({ Bucket: b, Key: k, Body: body2, ContentType: ct }));
        };
      }
      await s3Send(bucket, key, body, contentType);
    },
  };

  const fsOps: FsOps = {
    readFile: (p) => readFileSync(p),
    moveDir: (from, to) => renameSync(from, to),
    writeFile: (p, contents) => writeFileSync(p, contents),
  };

  const logger: Logger = {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };

  await runLinkPersonaMedia(opts, {
    prisma: prisma as unknown as PrismaLike,
    s3: putter,
    fs: fsOps,
    toWebP,
    logger,
  });

  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
}

// Only run when executed directly (not when imported by tests). The CJS-style
// require.main check works because tsx and the backend tsconfig compile to
// CommonJS.
if (require.main === module) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
