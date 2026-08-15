import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const findUniqueCharacter = vi.fn();
const updateMany = vi.fn();
const create = vi.fn();
const transaction = vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
const requireAuth = vi.fn();
const verifyAuthToken = vi.fn();

vi.mock("@/lib/auth", () => ({ requireAuth, verifyAuthToken }));
vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: { findUnique: (...args: unknown[]) => findUniqueCharacter(...args) },
    characterMedia: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      create: (...args: unknown[]) => create(...args),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

function req(body: unknown) {
  return new Request("http://localhost/api/characters/char-1/gallery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({ id: "char-1" }) };
}

beforeEach(() => {
  findUniqueCharacter.mockReset();
  updateMany.mockReset();
  create.mockReset();
  transaction.mockClear();
  requireAuth.mockReset();
  verifyAuthToken.mockReset();
  // Phase 28 gated this legacy callback off by default (see route.ts); the
  // isDisplay single-winner logic under test still lives behind this flag.
  process.env.ENABLE_LEGACY_PERSONA_CALLBACK = "true";
});

afterEach(() => {
  delete process.env.ENABLE_LEGACY_PERSONA_CALLBACK;
});

describe("POST /api/characters/[id]/gallery (write path single-winner)", () => {
  it("is gated off (410) by default per Phase 28's legacy-callback retirement", async () => {
    delete process.env.ENABLE_LEGACY_PERSONA_CALLBACK;
    requireAuth.mockResolvedValue({ id: "user-1" });

    const { POST } = await import("./route");
    const res = await POST(req({ url: "new.jpg", kind: "image", isDisplay: true }), ctx());

    expect(res.status).toBe(410);
    expect(create).not.toHaveBeenCalled();
  });

  it("posting isDisplay: true clears the previous display image, exactly one remains", async () => {
    requireAuth.mockResolvedValue({ id: "user-1" });
    findUniqueCharacter.mockResolvedValue({ ownerUserId: "user-1" });
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue({ id: "new-media", url: "new.jpg", isPrimary: false, isDisplay: true });

    const { POST } = await import("./route");
    const res = await POST(req({ url: "new.jpg", kind: "image", isDisplay: true }), ctx());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isDisplay).toBe(true);
    expect(body.isPrimary).toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { characterId: "char-1", isDisplay: true },
      data: { isDisplay: false },
    });
    // isPrimary was not set on this request, so its single-winner clear must not run.
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPrimary: true }) }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not weaken the existing isPrimary single-winner handling", async () => {
    requireAuth.mockResolvedValue({ id: "user-1" });
    findUniqueCharacter.mockResolvedValue({ ownerUserId: "user-1" });
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue({ id: "new-media", url: "new.jpg", isPrimary: true, isDisplay: false });

    const { POST } = await import("./route");
    const res = await POST(req({ url: "new.jpg", kind: "image", isPrimary: true }), ctx());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isPrimary).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { characterId: "char-1", isPrimary: true },
      data: { isPrimary: false },
    });
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isDisplay: true }) }),
    );
  });

  it("rejects when the requester does not own the character", async () => {
    requireAuth.mockResolvedValue({ id: "user-1" });
    findUniqueCharacter.mockResolvedValue({ ownerUserId: "someone-else" });

    const { POST } = await import("./route");
    const res = await POST(req({ url: "new.jpg", kind: "image", isDisplay: true }), ctx());

    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
