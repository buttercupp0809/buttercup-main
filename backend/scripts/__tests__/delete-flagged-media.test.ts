import { beforeEach, describe, expect, it } from "vitest";
import {
  runDeleteFlaggedMedia,
  wouldLeaveNoDisplay,
  type DeleteOptions,
  type FsOps,
  type Logger,
  type PrismaLike,
  type S3Deleter,
} from "../delete-flagged-media";
import type { ScanReport } from "../scan-distortion";

const prevBucket = process.env.POPPY_S3_BUCKET_GENERATED;
process.env.POPPY_S3_BUCKET_GENERATED = "test-generated";
void prevBucket;

function baseOptions(overrides: Partial<DeleteOptions> = {}): DeleteOptions {
  return {
    reportPath: "/tmp/report.json",
    outputLogPath: "/tmp/delete-log.json",
    target: "local",
    dryRun: true,
    apply: false,
    ...overrides,
  };
}

function makeLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeFs(report: ScanReport): { fs: FsOps; writes: Map<string, string> } {
  const writes = new Map<string, string>();
  const fs: FsOps = {
    readFile: () => Buffer.from(JSON.stringify(report)),
    writeFile: (p, contents) => {
      writes.set(p, contents);
    },
  };
  return { fs, writes };
}

interface PrismaState {
  characterMedia: Map<
    string,
    { id: string; characterId: string; isDisplay: boolean; hidden: boolean }
  >;
  mediaAsset: Map<
    string,
    { id: string; characterId: string | null; s3Key: string | null }
  >;
  cmDeletes: string[];
  maDeletes: string[];
}

function makePrisma(initial: PrismaState): { prisma: PrismaLike; state: PrismaState } {
  const state = initial;
  const prisma: PrismaLike = {
    characterMedia: {
      findMany: async (args) => {
        const w = args.where as { characterId?: string; isDisplay?: boolean; hidden?: boolean };
        return [...state.characterMedia.values()]
          .filter((r) => {
            if (w.characterId && r.characterId !== w.characterId) return false;
            if (w.isDisplay !== undefined && r.isDisplay !== w.isDisplay) return false;
            if (w.hidden !== undefined && r.hidden !== w.hidden) return false;
            return true;
          })
          .map((r) => ({ id: r.id }));
      },
      findUnique: async (args) => {
        const row = state.characterMedia.get(args.where.id);
        return row ? { id: row.id } : null;
      },
      delete: async (args) => {
        if (!state.characterMedia.has(args.where.id)) {
          const err = new Error(`Record to delete not found (id=${args.where.id})`);
          throw err;
        }
        state.characterMedia.delete(args.where.id);
        state.cmDeletes.push(args.where.id);
        return { id: args.where.id };
      },
    },
    mediaAsset: {
      findMany: async (args) => {
        const w = args.where as { characterId?: string; s3Key?: string };
        return [...state.mediaAsset.values()]
          .filter((r) => {
            if (w.characterId && r.characterId !== w.characterId) return false;
            if (w.s3Key && r.s3Key !== w.s3Key) return false;
            return true;
          })
          .map((r) => ({ id: r.id }));
      },
      delete: async (args) => {
        if (!state.mediaAsset.has(args.where.id)) {
          throw new Error(`Record to delete not found (id=${args.where.id})`);
        }
        state.mediaAsset.delete(args.where.id);
        state.maDeletes.push(args.where.id);
        return { id: args.where.id };
      },
    },
  };
  return { prisma, state };
}

interface S3State {
  keys: Set<string>;
  deleted: string[];
}
function makeS3(initial: S3State): { s3: S3Deleter; state: S3State } {
  const state = initial;
  const s3: S3Deleter = {
    del: async (bucket, key) => {
      const existed = state.keys.has(key);
      if (existed) state.keys.delete(key);
      state.deleted.push(`${bucket}/${key}`);
      return existed;
    },
  };
  return { s3, state };
}

function baseScanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    at: "2026-01-01T00:00:00.000Z",
    target: "local",
    model: "claude-haiku-4-5-20251001",
    minConfidence: 0.75,
    totals: { scanned: 0, flagged: 0, clean: 0, needsReview: 0, errors: 0 },
    flagged: [],
    needsReview: [],
    errors: [],
    ...overrides,
  };
}

describe("wouldLeaveNoDisplay", () => {
  it("true when every display id is in the delete set", () => {
    expect(wouldLeaveNoDisplay(new Set(["a", "b"]), new Set(["a", "b", "c"]))).toBe(true);
  });
  it("false when at least one display id survives", () => {
    expect(wouldLeaveNoDisplay(new Set(["a", "b"]), new Set(["a"]))).toBe(false);
  });
  it("empty display set is caller-guarded (function reports 'nothing survives' vacuously)", () => {
    // The runner treats displayIds.size===0 as 'no hero present, out of scope'
    // and does NOT invoke the safety gate. So the vacuous true here is fine.
    expect(wouldLeaveNoDisplay(new Set(), new Set(["a"]))).toBe(true);
  });
});

describe("runDeleteFlaggedMedia", () => {
  const flaggedReport = baseScanReport({
    flagged: [
      {
        characterId: "char-1",
        variant: 1,
        webpKey: "images/personas/char-1/p1.webp",
        pngKey: "images/personas/char-1/p1.png",
        characterMediaId: "cm-1",
        judgment: {
          distorted: true,
          blurry: false,
          anatomy_ok: false,
          confidence: 0.9,
          reason: "melted fingers",
        },
        confidence: 0.9,
        reason: "melted fingers",
      },
    ],
    totals: { scanned: 1, flagged: 1, clean: 0, needsReview: 0, errors: 0 },
  });

  let prismaState: PrismaState;
  let s3State: S3State;

  beforeEach(() => {
    prismaState = {
      characterMedia: new Map([
        // Display row (hero) that MUST survive.
        ["cm-hero", { id: "cm-hero", characterId: "char-1", isDisplay: true, hidden: false }],
        // Flagged variant row (non-display) that we want to remove.
        ["cm-1", { id: "cm-1", characterId: "char-1", isDisplay: false, hidden: false }],
      ]),
      mediaAsset: new Map([
        ["ma-1", { id: "ma-1", characterId: "char-1", s3Key: "images/personas/char-1/p1.webp" }],
      ]),
      cmDeletes: [],
      maDeletes: [],
    };
    s3State = {
      keys: new Set([
        "images/personas/char-1/p1.webp",
        "images/personas/char-1/p1.png",
      ]),
      deleted: [],
    };
  });

  it("dry run performs zero S3 and zero prisma deletes", async () => {
    const { fs, writes } = makeFs(flaggedReport);
    const { prisma } = makePrisma(prismaState);
    const { s3 } = makeS3(s3State);
    const report = await runDeleteFlaggedMedia(baseOptions({ dryRun: true, apply: false }), {
      prisma,
      s3,
      fs,
      logger: makeLogger(),
    });
    expect(s3State.deleted).toEqual([]);
    expect(prismaState.cmDeletes).toEqual([]);
    expect(prismaState.maDeletes).toEqual([]);
    expect(report.totals.s3Deleted).toBe(0);
    expect(report.totals.rowsDeleted).toBe(0);
    expect(writes.has("/tmp/delete-log.json")).toBe(true);
  });

  it("apply deletes paired S3 keys and both row types", async () => {
    const { fs } = makeFs(flaggedReport);
    const { prisma } = makePrisma(prismaState);
    const { s3 } = makeS3(s3State);
    const report = await runDeleteFlaggedMedia(
      baseOptions({ dryRun: false, apply: true }),
      { prisma, s3, fs, logger: makeLogger() },
    );
    expect(s3State.deleted).toContain("test-generated/images/personas/char-1/p1.webp");
    expect(s3State.deleted).toContain("test-generated/images/personas/char-1/p1.png");
    expect(prismaState.cmDeletes).toEqual(["cm-1"]);
    expect(prismaState.maDeletes).toEqual(["ma-1"]);
    expect(report.totals.rowsDeleted).toBe(2);
    expect(report.totals.s3Deleted).toBe(2);
  });

  it("is idempotent on a second run", async () => {
    const { fs } = makeFs(flaggedReport);
    const { prisma } = makePrisma(prismaState);
    const { s3 } = makeS3(s3State);
    await runDeleteFlaggedMedia(
      baseOptions({ dryRun: false, apply: true }),
      { prisma, s3, fs, logger: makeLogger() },
    );
    // Second run: rows gone, S3 keys gone. Nothing should throw and no new
    // rows should be deleted (already gone).
    const secondFs = makeFs(flaggedReport).fs;
    const report = await runDeleteFlaggedMedia(
      baseOptions({ dryRun: false, apply: true }),
      { prisma, s3, fs: secondFs, logger: makeLogger() },
    );
    // No further CharacterMedia deletes on the second run (already gone).
    expect(prismaState.cmDeletes).toEqual(["cm-1"]);
    // No further MediaAsset deletes either.
    expect(prismaState.maDeletes).toEqual(["ma-1"]);
    // The report distinguishes deleted vs skipped.
    expect(report.totals.rowsDeleted).toBe(0);
    // s3 del is called again, but reports the object as already gone (false).
    expect(report.totals.s3Deleted).toBe(0);
  });

  it("refuses to delete when it would leave a character with zero display images", async () => {
    // Mark the flagged row itself as the ONLY display row.
    prismaState.characterMedia = new Map([
      ["cm-1", { id: "cm-1", characterId: "char-1", isDisplay: true, hidden: false }],
    ]);
    const { fs } = makeFs(flaggedReport);
    const { prisma } = makePrisma(prismaState);
    const { s3 } = makeS3(s3State);
    const report = await runDeleteFlaggedMedia(
      baseOptions({ dryRun: false, apply: true }),
      { prisma, s3, fs, logger: makeLogger() },
    );
    expect(s3State.deleted).toEqual([]);
    expect(prismaState.cmDeletes).toEqual([]);
    expect(prismaState.maDeletes).toEqual([]);
    expect(report.skippedCharacters).toHaveLength(1);
    expect(report.skippedCharacters[0].characterId).toBe("char-1");
    expect(report.totals.charactersSkippedForSafety).toBe(1);
  });
});
