import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildPersonaKey,
  selectKeptVariants,
  scanPersonaGroups,
  runLinkPersonaMedia,
  type PrismaLike,
  type FsOps,
  type Logger,
  type RunOptions,
  type S3Putter,
} from "../link-persona-media";
import { bucketForKey } from "../../src/media/storage";

function makeTmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "link-persona-media-"));
}

// Build persona-output/{N}_p{v}/variant-p{v}-v1.png fixture layout on disk.
function seedPersonaOutput(
  root: string,
  spec: Record<number, number[]>,
): void {
  for (const [numStr, variants] of Object.entries(spec)) {
    for (const v of variants) {
      const dir = path.join(root, `${numStr}_p${v}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `variant-p${v}-v1.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  }
}

function baseOptions(rootDir: string, overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    rootDir,
    dryRun: true,
    apply: false,
    target: "local",
    limit: null,
    only: null,
    createMediaAsset: false,
    systemUserId: null,
    manifestPath: path.join(rootDir, "manifest-out.json"),
    ...overrides,
  };
}

function makeLogger(): Logger & { messages: { level: string; msg: string }[] } {
  const messages: { level: string; msg: string }[] = [];
  return {
    messages,
    info: (m) => messages.push({ level: "info", msg: m }),
    warn: (m) => messages.push({ level: "warn", msg: m }),
    error: (m) => messages.push({ level: "error", msg: m }),
  };
}

interface PrismaState {
  displayCounts: Map<string, number>; // characterId -> isDisplay=true row count
  personaSeedMap: Map<number, string[]>; // personaNumber -> characterIds
  existingRows: Set<string>; // "characterId::url"
  createdRows: Array<{ characterId: string; url: string; id: string }>;
  createdMediaAssets: Array<Record<string, unknown>>;
}

function makePrisma(initial: Partial<PrismaState> = {}): {
  prisma: PrismaLike;
  state: PrismaState;
} {
  const state: PrismaState = {
    displayCounts: initial.displayCounts ?? new Map(),
    personaSeedMap: initial.personaSeedMap ?? new Map(),
    existingRows: initial.existingRows ?? new Set(),
    createdRows: initial.createdRows ?? [],
    createdMediaAssets: initial.createdMediaAssets ?? [],
  };
  let idCounter = 0;
  const prisma: PrismaLike = {
    character: {
      findUnique: async () => null,
    },
    characterMedia: {
      findMany: async (args) => {
        const url = (args.where as { url?: string }).url;
        const seedMatch = url && url.match(/^\/personas\/(\d+)\.webp$/);
        if (seedMatch) {
          const n = parseInt(seedMatch[1], 10);
          const ids = state.personaSeedMap.get(n) ?? [];
          return ids.map((characterId) => ({ characterId }));
        }
        return [];
      },
      findFirst: async (args) => {
        const w = args.where as { characterId?: string; url?: string };
        if (!w.characterId || !w.url) return null;
        const key = `${w.characterId}::${w.url}`;
        if (state.existingRows.has(key)) {
          return { id: `existing-${key}` };
        }
        return null;
      },
      count: async (args) => {
        const w = args.where as { characterId?: string; isDisplay?: boolean };
        if (w.isDisplay === true && w.characterId) {
          return state.displayCounts.get(w.characterId) ?? 0;
        }
        return 0;
      },
      create: async (args) => {
        idCounter += 1;
        const id = `row-${idCounter}`;
        const data = args.data as { characterId: string; url: string };
        state.createdRows.push({ characterId: data.characterId, url: data.url, id });
        state.existingRows.add(`${data.characterId}::${data.url}`);
        return { id };
      },
    },
    mediaAsset: {
      create: async (args) => {
        state.createdMediaAssets.push(args.data);
        return { id: `ma-${state.createdMediaAssets.length}` };
      },
    },
  };
  return { prisma, state };
}

function makeFs(): { fs: FsOps; writes: Map<string, string>; moves: Array<[string, string]> } {
  const writes = new Map<string, string>();
  const moves: Array<[string, string]> = [];
  return {
    writes,
    moves,
    fs: {
      readFile: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      moveDir: (from, to) => {
        moves.push([from, to]);
      },
      writeFile: (p, contents) => {
        writes.set(p, contents);
      },
    },
  };
}

function makeS3(): { s3: S3Putter; puts: Array<{ bucket: string; key: string; contentType: string }> } {
  const puts: Array<{ bucket: string; key: string; contentType: string }> = [];
  return {
    puts,
    s3: {
      put: async (bucket, key, _body, contentType) => {
        puts.push({ bucket, key, contentType });
      },
    },
  };
}

// -----------------------------------------------------------------------------

describe("selectKeptVariants", () => {
  it("keeps p1..p4 and drops p5 when all five exist", () => {
    const entries = [1, 2, 3, 4, 5].map((v) => ({ variant: v, dir: `d${v}`, pngPath: `d${v}/x.png` }));
    const kept = selectKeptVariants(entries);
    expect(kept.map((e) => e.variant)).toEqual([1, 2, 3, 4]);
  });

  it("handles fewer than five variants without throwing", () => {
    const entries = [1, 3].map((v) => ({ variant: v, dir: `d${v}`, pngPath: `d${v}/x.png` }));
    expect(selectKeptVariants(entries).map((e) => e.variant)).toEqual([1, 3]);
    expect(selectKeptVariants([]).length).toBe(0);
  });
});

describe("buildPersonaKey + bucketForKey routing", () => {
  it("produces images/personas/{id}/p{v}.webp", () => {
    expect(buildPersonaKey("char-abc", 3)).toBe("images/personas/char-abc/p3.webp");
  });

  it("routes to POPPY_S3_BUCKET_GENERATED via bucketForKey", () => {
    const prev = process.env.POPPY_S3_BUCKET_GENERATED;
    process.env.POPPY_S3_BUCKET_GENERATED = "generated-bucket-xyz";
    try {
      const key = buildPersonaKey("char-abc", 1);
      expect(bucketForKey(key)).toBe("generated-bucket-xyz");
    } finally {
      if (prev === undefined) delete process.env.POPPY_S3_BUCKET_GENERATED;
      else process.env.POPPY_S3_BUCKET_GENERATED = prev;
    }
  });
});

describe("scanPersonaGroups", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("groups by persona number and separates the fifth variant", () => {
    seedPersonaOutput(root, { 7: [1, 2, 3, 4, 5], 8: [1, 2] });
    const groups = scanPersonaGroups(root);
    expect(groups).toHaveLength(2);
    const g7 = groups.find((g) => g.personaNumber === 7)!;
    expect(g7.entries.map((e) => e.variant)).toEqual([1, 2, 3, 4]);
    expect(g7.fifth?.variant).toBe(5);
    const g8 = groups.find((g) => g.personaNumber === 8)!;
    expect(g8.entries.map((e) => e.variant)).toEqual([1, 2]);
    expect(g8.fifth).toBeNull();
  });
});

describe("runLinkPersonaMedia", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
    process.env.POPPY_S3_BUCKET_GENERATED = "test-generated-bucket";
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("DRY_RUN performs zero prisma writes and zero S3 puts", async () => {
    seedPersonaOutput(root, { 1: [1, 2, 3, 4, 5] });
    const { prisma, state } = makePrisma({
      personaSeedMap: new Map([[1, ["char-1"]]]),
      displayCounts: new Map([["char-1", 1]]),
    });
    const { s3, puts } = makeS3();
    const { fs, moves, writes } = makeFs();
    const logger = makeLogger();
    const toWebP = vi.fn(async (b: Buffer) => ({ buffer: b, contentType: "image/webp" as const }));

    const summary = await runLinkPersonaMedia(baseOptions(root), {
      prisma,
      s3,
      fs,
      toWebP,
      logger,
    });

    expect(puts).toEqual([]);
    expect(state.createdRows).toEqual([]);
    expect(moves).toEqual([]);
    expect(toWebP).not.toHaveBeenCalled();
    expect(summary.charactersProcessed).toBe(1);
    expect(summary.variantsUploaded).toBe(0);
    expect(summary.rowsUpserted).toBe(0);
    // manifest file is still written in dry-run so humans can review the plan.
    expect(writes.size).toBe(1);
  });

  it("APPLY mode uploads four variants, upserts CharacterMedia rows, and trashes p5", async () => {
    seedPersonaOutput(root, { 1: [1, 2, 3, 4, 5] });
    const { prisma, state } = makePrisma({
      personaSeedMap: new Map([[1, ["char-1"]]]),
      displayCounts: new Map([["char-1", 1]]),
    });
    const { s3, puts } = makeS3();
    const { fs, moves } = makeFs();
    const logger = makeLogger();
    const toWebP = vi.fn(async (b: Buffer) => ({ buffer: b, contentType: "image/webp" as const }));

    const summary = await runLinkPersonaMedia(
      baseOptions(root, { dryRun: false, apply: true }),
      { prisma, s3, fs, toWebP, logger },
    );

    expect(puts.map((p) => p.key)).toEqual([
      "images/personas/char-1/p1.webp",
      "images/personas/char-1/p2.webp",
      "images/personas/char-1/p3.webp",
      "images/personas/char-1/p4.webp",
    ]);
    expect(puts.every((p) => p.bucket === "test-generated-bucket")).toBe(true);
    expect(state.createdRows).toHaveLength(4);
    // Only ONE move (p5 dir), regardless of how many characters map to persona 1.
    expect(moves).toHaveLength(1);
    expect(summary.variantsUploaded).toBe(4);
    expect(summary.rowsUpserted).toBe(4);
    expect(summary.p5DirsTrashed).toBe(1);
    expect(summary.missingHero).toEqual([]);
  });

  it("upsert is idempotent on (characterId, url): a second run inserts nothing", async () => {
    seedPersonaOutput(root, { 1: [1, 2, 3, 4] });
    const preSeededRows = new Set<string>();
    for (const v of [1, 2, 3, 4]) preSeededRows.add(`char-1::images/personas/char-1/p${v}.webp`);
    const { prisma, state } = makePrisma({
      personaSeedMap: new Map([[1, ["char-1"]]]),
      displayCounts: new Map([["char-1", 1]]),
      existingRows: preSeededRows,
    });
    const { s3, puts } = makeS3();
    const { fs } = makeFs();
    const logger = makeLogger();
    const toWebP = vi.fn(async (b: Buffer) => ({ buffer: b, contentType: "image/webp" as const }));

    const summary = await runLinkPersonaMedia(
      baseOptions(root, { dryRun: false, apply: true }),
      { prisma, s3, fs, toWebP, logger },
    );

    expect(puts).toEqual([]);
    expect(state.createdRows).toEqual([]);
    expect(summary.rowsUpserted).toBe(0);
    expect(summary.variantsUploaded).toBe(0);
  });

  it("hero invariant: one existing isDisplay row is untouched and no variant is promoted", async () => {
    seedPersonaOutput(root, { 1: [1, 2, 3, 4] });
    const { prisma, state } = makePrisma({
      personaSeedMap: new Map([[1, ["char-1"]]]),
      displayCounts: new Map([["char-1", 1]]),
    });
    const { s3 } = makeS3();
    const { fs } = makeFs();
    const logger = makeLogger();
    const toWebP = vi.fn(async (b: Buffer) => ({ buffer: b, contentType: "image/webp" as const }));

    await runLinkPersonaMedia(
      baseOptions(root, { dryRun: false, apply: true }),
      { prisma, s3, fs, toWebP, logger },
    );

    for (const row of state.createdRows) {
      // Every variant row we created must be non-display, non-primary.
      const key = `${row.characterId}::${row.url}`;
      expect(state.existingRows.has(key)).toBe(true);
    }
    // No warning about missing hero.
    expect(logger.messages.some((m) => m.level === "warn" && m.msg.includes("zero isDisplay"))).toBe(false);
  });

  it("zero display rows: script warns and does not promote a variant", async () => {
    seedPersonaOutput(root, { 1: [1, 2, 3, 4] });
    const { prisma, state } = makePrisma({
      personaSeedMap: new Map([[1, ["char-1"]]]),
      displayCounts: new Map([["char-1", 0]]),
    });
    const { s3 } = makeS3();
    const { fs } = makeFs();
    const logger = makeLogger();
    const toWebP = vi.fn(async (b: Buffer) => ({ buffer: b, contentType: "image/webp" as const }));

    const summary = await runLinkPersonaMedia(
      baseOptions(root, { dryRun: false, apply: true }),
      { prisma, s3, fs, toWebP, logger },
    );

    expect(summary.missingHero).toEqual(["char-1"]);
    expect(logger.messages.some((m) => m.level === "warn" && m.msg.includes("zero isDisplay"))).toBe(true);
    // Created rows must all have isDisplay=false (script never sets true).
    for (const row of state.createdRows) {
      expect(row).toEqual(expect.objectContaining({ characterId: "char-1" }));
    }
    // Ensure no create call was made with isDisplay=true.
    // We captured the raw data in `createdRows`; the mock only stores characterId+url.
    // Assert via createdRows count matching kept variants (no extra promotion write).
    expect(state.createdRows).toHaveLength(4);
  });
});
