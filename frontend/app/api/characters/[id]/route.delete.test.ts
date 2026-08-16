import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirstCharacter = vi.fn();
const findManyMediaAsset = vi.fn();
const findManyCharacterMedia = vi.fn();
const deleteManyMediaAsset = vi.fn();
const deleteCharacter = vi.fn();
const transaction = vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
const requireAuth = vi.fn();
const deleteS3Keys = vi.fn();

vi.mock("@/lib/auth", () => ({ requireAuth, verifyAuthToken: vi.fn() }));

vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: {
      findFirst: (...a: unknown[]) => findFirstCharacter(...a),
      delete: (...a: unknown[]) => deleteCharacter(...a),
    },
    mediaAsset: {
      findMany: (...a: unknown[]) => findManyMediaAsset(...a),
      deleteMany: (...a: unknown[]) => deleteManyMediaAsset(...a),
    },
    characterMedia: {
      findMany: (...a: unknown[]) => findManyCharacterMedia(...a),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

vi.mock("@/lib/s3-delete", () => ({
  deleteS3Keys: (...a: unknown[]) => deleteS3Keys(...a),
  extractS3Key: (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith("/")) return null;
    return url;
  },
}));

function ctx(id = "char-1") {
  return { params: Promise.resolve({ id }) };
}

function req() {
  return new Request(`http://localhost/api/characters/char-1`, { method: "DELETE" });
}

beforeEach(() => {
  findFirstCharacter.mockReset();
  findManyMediaAsset.mockReset();
  findManyCharacterMedia.mockReset();
  deleteManyMediaAsset.mockReset();
  deleteCharacter.mockReset();
  transaction.mockClear();
  requireAuth.mockReset();
  deleteS3Keys.mockReset();
  deleteS3Keys.mockResolvedValue({ attempted: 0, deleted: 0, skipped: 0, errors: [] });
});

describe("DELETE /api/characters/[id]", () => {
  it("returns 404 when the character is not owned by the caller", async () => {
    requireAuth.mockResolvedValue({ id: "user-a" });
    findFirstCharacter.mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
    expect(deleteCharacter).not.toHaveBeenCalled();
    expect(deleteS3Keys).not.toHaveBeenCalled();
  });

  it("scopes the ownership check to ownerUserId", async () => {
    requireAuth.mockResolvedValue({ id: "user-a" });
    findFirstCharacter.mockResolvedValue({ id: "char-1" });
    findManyMediaAsset.mockResolvedValue([]);
    findManyCharacterMedia.mockResolvedValue([]);
    const { DELETE } = await import("./route");
    await DELETE(req(), ctx());
    const args = findFirstCharacter.mock.calls[0][0];
    expect(args.where).toEqual({ id: "char-1", ownerUserId: "user-a" });
  });

  it("deletes MediaAsset rows then Character in one transaction, dedupes S3 keys", async () => {
    requireAuth.mockResolvedValue({ id: "user-a" });
    findFirstCharacter.mockResolvedValue({ id: "char-1" });
    findManyMediaAsset.mockResolvedValue([
      { s3Key: "images/user-a/a.png" },
      { s3Key: "images/user-a/b.png" },
      { s3Key: null },
    ]);
    findManyCharacterMedia.mockResolvedValue([
      { url: "images/user-a/a.png" }, // duplicate of MediaAsset row
      { url: "/personas/5.webp" }, // local skip
      { url: "images/user-a/c.png" },
    ]);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteManyMediaAsset).toHaveBeenCalledWith({
      where: { characterId: "char-1", userId: "user-a" },
    });
    expect(deleteCharacter).toHaveBeenCalledWith({ where: { id: "char-1" } });
    const keysArg = deleteS3Keys.mock.calls[0][0] as string[];
    expect(new Set(keysArg)).toEqual(
      new Set(["images/user-a/a.png", "images/user-a/b.png", "images/user-a/c.png"]),
    );
  });

  it("returns 409 when the DB delete throws (e.g. Restrict FK)", async () => {
    requireAuth.mockResolvedValue({ id: "user-a" });
    findFirstCharacter.mockResolvedValue({ id: "char-1" });
    findManyMediaAsset.mockResolvedValue([]);
    findManyCharacterMedia.mockResolvedValue([]);
    transaction.mockRejectedValueOnce(new Error("fk_violation"));
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(409);
    expect(deleteS3Keys).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed id", async () => {
    requireAuth.mockResolvedValue({ id: "user-a" });
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), ctx("not a safe id!!"));
    expect(res.status).toBe(400);
    expect(findFirstCharacter).not.toHaveBeenCalled();
  });
});
