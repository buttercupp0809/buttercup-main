/*
 * Feature E, step 2: delete flagged persona media from S3 and the database.
 *
 * Input: Plans/inference-aws/distortion-report.json produced by
 *        scan-distortion.ts and APPROVED by a human.
 *
 * Behaviour:
 *   - For each flagged item: delete the WebP and any paired PNG from S3
 *     (bucket routed via bucketForKey), then hard-delete the CharacterMedia
 *     row by id, then hard-delete any linked MediaAsset row (matched by
 *     characterId + s3Key when the report does not carry an explicit id).
 *   - Idempotent: keys/rows already gone are skipped, not treated as errors.
 *   - Safety: if the planned deletions for a character would leave zero
 *     visible display images (isDisplay=true AND hidden=false), the entire
 *     character is SKIPPED and reported. Nothing is deleted for that
 *     character.
 *
 * Guardrails:
 *   - DRY_RUN=1 (default) performs zero S3 deletes and zero prisma writes.
 *   - APPLY=1 required to write, and only when TARGET=local. Prod is a
 *     human-only action.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bucketForKey } from "../src/media/storage";
import type { FlaggedItem, ScanReport } from "./scan-distortion";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface DeleteOptions {
  reportPath: string;
  outputLogPath: string;
  target: string;
  dryRun: boolean;
  apply: boolean;
}

export interface DeletionAction {
  characterId: string;
  variant: number;
  webpKey: string;
  pngKey: string | null;
  characterMediaId: string | null;
  mediaAssetId: string | null;
  s3Deleted: string[];
  s3Skipped: string[];
  rowsDeleted: string[];
  rowsSkipped: string[];
}

export interface DeletionReport {
  at: string;
  mode: "dry-run" | "apply";
  target: string;
  applied: DeletionAction[];
  skippedCharacters: Array<{ characterId: string; reason: string; flaggedCount: number }>;
  totals: {
    charactersConsidered: number;
    charactersApplied: number;
    charactersSkippedForSafety: number;
    s3Deleted: number;
    rowsDeleted: number;
  };
}

export interface PrismaLike {
  characterMedia: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<Array<Record<string, unknown>>>;
    findUnique: (args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }) => Promise<Record<string, unknown> | null>;
    delete: (args: { where: { id: string } }) => Promise<Record<string, unknown>>;
  };
  mediaAsset: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<Array<Record<string, unknown>>>;
    delete: (args: { where: { id: string } }) => Promise<Record<string, unknown>>;
  };
}

export interface S3Deleter {
  // Delete a specific key. Return true if the object existed and was removed,
  // false if it was already gone. Missing objects are not errors.
  del: (bucket: string, key: string) => Promise<boolean>;
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
  prisma: PrismaLike;
  s3: S3Deleter;
  fs: FsOps;
  logger: Logger;
}

// -----------------------------------------------------------------------------
// Env parsing
// -----------------------------------------------------------------------------

export function parseOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  reportPath: string,
  outputLogPath: string,
): DeleteOptions {
  const apply = env.APPLY === "1";
  const dryRunRaw = env.DRY_RUN;
  const dryRun = dryRunRaw === undefined ? !apply : dryRunRaw === "1";
  return {
    reportPath,
    outputLogPath,
    target: env.TARGET ?? "local",
    dryRun,
    apply,
  };
}

// -----------------------------------------------------------------------------
// Core
// -----------------------------------------------------------------------------

// Given the current CharacterMedia display rows for a character and the ids
// that would be deleted, decide whether at least one display row survives.
export function wouldLeaveNoDisplay(
  displayRowIds: Set<string>,
  deletingIds: Set<string>,
): boolean {
  for (const id of displayRowIds) {
    if (!deletingIds.has(id)) return false;
  }
  return true;
}

function groupByCharacter(flagged: FlaggedItem[]): Map<string, FlaggedItem[]> {
  const map = new Map<string, FlaggedItem[]>();
  for (const item of flagged) {
    const list = map.get(item.characterId) ?? [];
    list.push(item);
    map.set(item.characterId, list);
  }
  return map;
}

export async function runDeleteFlaggedMedia(
  opts: DeleteOptions,
  deps: RunDeps,
): Promise<DeletionReport> {
  const raw = deps.fs.readFile(opts.reportPath).toString("utf8");
  const scan = JSON.parse(raw) as ScanReport;
  const flagged = Array.isArray(scan.flagged) ? scan.flagged : [];
  const groups = groupByCharacter(flagged);

  const report: DeletionReport = {
    at: new Date().toISOString(),
    mode: opts.dryRun ? "dry-run" : "apply",
    target: opts.target,
    applied: [],
    skippedCharacters: [],
    totals: {
      charactersConsidered: groups.size,
      charactersApplied: 0,
      charactersSkippedForSafety: 0,
      s3Deleted: 0,
      rowsDeleted: 0,
    },
  };

  deps.logger.info(
    `[delete-flagged-media] mode=${report.mode} target=${opts.target} characters=${groups.size} flaggedItems=${flagged.length}`,
  );

  for (const [characterId, items] of groups.entries()) {
    // Safety gate: never leave a character with zero display images.
    const displayRows = (await deps.prisma.characterMedia.findMany({
      where: { characterId, isDisplay: true, hidden: false },
      select: { id: true },
    })) as Array<{ id: string }>;
    const displayIds = new Set(displayRows.map((r) => r.id));
    const deletingIds = new Set(
      items.map((i) => i.characterMediaId).filter((id): id is string => Boolean(id)),
    );

    if (displayIds.size > 0 && wouldLeaveNoDisplay(displayIds, deletingIds)) {
      const reason =
        "would leave character with zero display images; refusing to delete";
      report.skippedCharacters.push({
        characterId,
        reason,
        flaggedCount: items.length,
      });
      report.totals.charactersSkippedForSafety++;
      deps.logger.warn(`[delete-flagged-media] SKIP ${characterId}: ${reason}`);
      continue;
    }

    for (const item of items) {
      const action: DeletionAction = {
        characterId,
        variant: item.variant,
        webpKey: item.webpKey,
        pngKey: item.pngKey,
        characterMediaId: item.characterMediaId,
        mediaAssetId: item.mediaAssetId ?? null,
        s3Deleted: [],
        s3Skipped: [],
        rowsDeleted: [],
        rowsSkipped: [],
      };

      const keys: string[] = [item.webpKey];
      if (item.pngKey) keys.push(item.pngKey);

      for (const key of keys) {
        const bucket = bucketForKey(key);
        if (opts.dryRun) {
          action.s3Skipped.push(`${bucket}/${key} (dry-run)`);
          deps.logger.info(`[delete-flagged-media] DRY s3://${bucket}/${key}`);
          continue;
        }
        if (!opts.apply) {
          throw new Error("[delete-flagged-media] refusing to write without APPLY=1");
        }
        const existed = await deps.s3.del(bucket, key);
        if (existed) {
          action.s3Deleted.push(`${bucket}/${key}`);
          report.totals.s3Deleted++;
        } else {
          action.s3Skipped.push(`${bucket}/${key} (already gone)`);
        }
      }

      // CharacterMedia row deletion.
      if (item.characterMediaId) {
        if (opts.dryRun) {
          action.rowsSkipped.push(`CharacterMedia:${item.characterMediaId} (dry-run)`);
        } else {
          const existing = await deps.prisma.characterMedia.findUnique({
            where: { id: item.characterMediaId },
            select: { id: true },
          });
          if (existing) {
            await deps.prisma.characterMedia.delete({ where: { id: item.characterMediaId } });
            action.rowsDeleted.push(`CharacterMedia:${item.characterMediaId}`);
            report.totals.rowsDeleted++;
          } else {
            action.rowsSkipped.push(`CharacterMedia:${item.characterMediaId} (already gone)`);
          }
        }
      }

      // Paired MediaAsset row deletion. If the report already carries an id,
      // delete that directly. Otherwise look up by (characterId, s3Key) so we
      // don't need the report to have been enriched.
      let mediaAssetIds: string[] = [];
      if (item.mediaAssetId) {
        mediaAssetIds = [item.mediaAssetId];
      } else if (!opts.dryRun) {
        const found = (await deps.prisma.mediaAsset.findMany({
          where: { characterId: item.characterId, s3Key: item.webpKey },
          select: { id: true },
        })) as Array<{ id: string }>;
        mediaAssetIds = found.map((r) => r.id);
      }

      for (const id of mediaAssetIds) {
        if (opts.dryRun) {
          action.rowsSkipped.push(`MediaAsset:${id} (dry-run)`);
          continue;
        }
        try {
          await deps.prisma.mediaAsset.delete({ where: { id } });
          action.rowsDeleted.push(`MediaAsset:${id}`);
          report.totals.rowsDeleted++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes("record") && msg.toLowerCase().includes("not found")) {
            action.rowsSkipped.push(`MediaAsset:${id} (already gone)`);
          } else {
            throw err;
          }
        }
      }

      report.applied.push(action);
      deps.logger.info(
        `[delete-flagged-media] ${opts.dryRun ? "DRY" : "APPLIED"} char=${characterId} p${item.variant} s3=${action.s3Deleted.length + action.s3Skipped.length} rows=${action.rowsDeleted.length + action.rowsSkipped.length}`,
      );
    }
    report.totals.charactersApplied++;
  }

  deps.fs.writeFile(opts.outputLogPath, JSON.stringify(report, null, 2));
  deps.logger.info(
    `[delete-flagged-media] wrote ${opts.outputLogPath} (s3Deleted=${report.totals.s3Deleted}, rowsDeleted=${report.totals.rowsDeleted}, skippedForSafety=${report.totals.charactersSkippedForSafety})`,
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
  const reportPath = path.join(repoRoot, "Plans", "inference-aws", "distortion-report.json");
  const outputLogPath = path.join(repoRoot, "Plans", "inference-aws", "distortion-delete-log.json");
  const opts = parseOptionsFromEnv(process.env, reportPath, outputLogPath);

  if (opts.apply && opts.target !== "local" && opts.target !== "prod") {
    throw new Error(
      `[delete-flagged-media] refusing to APPLY against TARGET=${opts.target}. Only 'local' or 'prod' is allowed.`,
    );
  }

  const { prisma } = await import("@buttercupp/database");
  const { S3Client, DeleteObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3Client = new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
  const s3: S3Deleter = {
    del: async (bucket, key) => {
      // Idempotent probe: HEAD first so we can distinguish "already gone" from
      // "actually deleted" in the log.
      let existed = true;
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (name === "NotFound" || status === 404) existed = false;
        else throw err;
      }
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return existed;
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

  await runDeleteFlaggedMedia(opts, {
    prisma: prisma as unknown as PrismaLike,
    s3,
    fs,
    logger,
  });

  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
}

if (require.main === module) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
