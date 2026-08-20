import { describe, expect, it, vi, beforeEach } from "vitest";

const findManyCharacter = vi.fn();
const groupByMediaAsset = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: { findMany: (...a: unknown[]) => findManyCharacter(...a) },
    mediaAsset: { groupBy: (...a: unknown[]) => groupByMediaAsset(...a) },
  },
  // listCompanions now imports the shared media ordering; the mock must expose
  // it or the module throws on the missing export.
  CHARACTER_MEDIA_ORDER_BY: [
    { isMain: "desc" },
    { isDisplay: "desc" },
    { isPrimary: "desc" },
    { sort: "asc" },
  ],
}));

// signAssetUrl reads env inside; stub it out so tests are hermetic.
vi.mock("@/lib/cdn", () => ({
  signAssetUrl: (k: string) => `signed:${k}`,
}));

const { listCompanions, deriveBadge, summarizeAssetGroups } = await import("@/lib/companions");

function ch(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Alice",
    contentRating: "sfw",
    visibility: "private",
    moderationStatus: "approved",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    media: [],
    ...overrides,
  };
}

describe("listCompanions", () => {
  beforeEach(() => {
    findManyCharacter.mockReset();
    groupByMediaAsset.mockReset();
  });

  it("scopes strictly to ownerUserId in the Prisma where", async () => {
    findManyCharacter.mockResolvedValue([]);
    groupByMediaAsset.mockResolvedValue([]);
    await listCompanions("user-a");
    const args = findManyCharacter.mock.calls[0][0];
    expect(args.where).toEqual({ ownerUserId: "user-a" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("returns empty and skips groupBy when the user has no characters", async () => {
    findManyCharacter.mockResolvedValue([]);
    const out = await listCompanions("user-a");
    expect(out).toEqual([]);
    expect(groupByMediaAsset).not.toHaveBeenCalled();
  });

  it("picks isDisplay over isPrimary over first, signing raw S3 keys", async () => {
    findManyCharacter.mockResolvedValue([
      ch({
        media: [
          { url: "characters/hero.png", isPrimary: true, isDisplay: false },
          { url: "characters/display.png", isPrimary: false, isDisplay: true },
        ],
      }),
    ]);
    groupByMediaAsset.mockResolvedValue([]);
    const [row] = await listCompanions("user-a");
    expect(row.avatarUrl).toBe("signed:characters/display.png");
    expect(row.gen.primaryReady).toBe(true);
  });

  it("passes through local /public paths without signing", async () => {
    findManyCharacter.mockResolvedValue([
      ch({ media: [{ url: "/personas/5.webp", isPrimary: true, isDisplay: true }] }),
    ]);
    groupByMediaAsset.mockResolvedValue([]);
    const [row] = await listCompanions("user-a");
    expect(row.avatarUrl).toBe("/personas/5.webp");
  });

  it("null avatar when the character has no image media", async () => {
    findManyCharacter.mockResolvedValue([ch({ media: [] })]);
    groupByMediaAsset.mockResolvedValue([]);
    const [row] = await listCompanions("user-a");
    expect(row.avatarUrl).toBeNull();
    expect(row.gen.primaryReady).toBe(false);
  });

  it("aggregates MediaAsset counts per character", async () => {
    findManyCharacter.mockResolvedValue([
      ch({ id: "c1", media: [] }),
      ch({ id: "c2", media: [] }),
    ]);
    groupByMediaAsset.mockResolvedValue([
      { characterId: "c1", status: "queued", _count: 2 },
      { characterId: "c1", status: "ready", _count: 1 },
      { characterId: "c2", status: "failed", _count: 3 },
    ]);
    const rows = await listCompanions("user-a");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.c1.gen).toMatchObject({ queued: 2, processing: 0, ready: 1, failed: 0 });
    expect(byId.c2.gen).toMatchObject({ queued: 0, processing: 0, ready: 0, failed: 3 });
  });

  it("scopes MediaAsset groupBy to (userId, character ids, kind image)", async () => {
    findManyCharacter.mockResolvedValue([ch({ id: "c1" }), ch({ id: "c2" })]);
    groupByMediaAsset.mockResolvedValue([]);
    await listCompanions("user-a");
    const args = groupByMediaAsset.mock.calls[0][0];
    expect(args.where.userId).toBe("user-a");
    expect(args.where.kind).toBe("image");
    expect(args.where.characterId).toEqual({ in: ["c1", "c2"] });
  });
});

describe("summarizeAssetGroups", () => {
  it("ignores groups for other characters", () => {
    const summary = summarizeAssetGroups(
      "c1",
      [
        { characterId: "c2", status: "queued", _count: 5 },
        { characterId: "c1", status: "processing", _count: 2 },
      ],
      false,
    );
    expect(summary).toEqual({
      queued: 0,
      processing: 2,
      ready: 0,
      failed: 0,
      primaryReady: false,
    });
  });
});

describe("deriveBadge", () => {
  it("failed wins over pending and ready", () => {
    expect(
      deriveBadge({ queued: 3, processing: 1, ready: 2, failed: 1, primaryReady: true }).kind,
    ).toBe("failed");
  });
  it("pending shows generating", () => {
    expect(
      deriveBadge({ queued: 1, processing: 0, ready: 0, failed: 0, primaryReady: false }).kind,
    ).toBe("generating");
  });
  it("primaryReady with nothing pending or failed shows ready", () => {
    expect(
      deriveBadge({ queued: 0, processing: 0, ready: 1, failed: 0, primaryReady: true }).kind,
    ).toBe("ready");
  });
  it("empty when nothing anywhere", () => {
    expect(
      deriveBadge({ queued: 0, processing: 0, ready: 0, failed: 0, primaryReady: false }).kind,
    ).toBe("empty");
  });
});
