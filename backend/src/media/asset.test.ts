import { describe, expect, it, vi, beforeEach } from "vitest";
import { _internal } from "./asset";
import { createReadyAsset } from "./asset";

vi.mock("@buttercupp/database", () => ({
  prisma: {
    mediaAsset: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    characterMedia: { create: vi.fn() },
  },
  backfillCharacterDisplay: vi.fn(),
}));

const { assertTransition, ALLOWED } = _internal;

describe("MediaAsset state machine", () => {
  it("queued -> processing is allowed", () => {
    expect(() => assertTransition("queued", "processing")).not.toThrow();
  });
  it("processing -> ready is allowed", () => {
    expect(() => assertTransition("processing", "ready")).not.toThrow();
  });
  it("processing -> processing is allowed (BullMQ retry re-entry)", () => {
    expect(() => assertTransition("processing", "processing")).not.toThrow();
  });
  it("queued -> failed is allowed", () => {
    expect(() => assertTransition("queued", "failed")).not.toThrow();
  });
  it("processing -> failed is allowed", () => {
    expect(() => assertTransition("processing", "failed")).not.toThrow();
  });

  it("ready -> anything throws", () => {
    expect(() => assertTransition("ready", "processing")).toThrow(/invalid_transition/);
    expect(() => assertTransition("ready", "failed")).toThrow(/invalid_transition/);
  });
  it("failed -> anything throws", () => {
    expect(() => assertTransition("failed", "ready")).toThrow(/invalid_transition/);
  });
  it("queued -> ready is not allowed (must pass through processing)", () => {
    expect(() => assertTransition("queued", "ready")).toThrow(/invalid_transition/);
  });

  it("ALLOWED is exhaustive for the four statuses", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual(["cold", "failed", "processing", "queued", "ready"].filter((k) => k !== "cold").sort());
  });
});

describe("createReadyAsset", () => {
  it("exported function exists", () => {
    expect(typeof createReadyAsset).toBe("function");
  });
});

describe("attachVideoCharacterMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a CharacterMedia row with kind video and isDisplay false", async () => {
    const { prisma, backfillCharacterDisplay } = await import("@buttercupp/database");
    const { attachVideoCharacterMedia } = await import("./asset");
    (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cm-video-1" });

    const result = await attachVideoCharacterMedia({ characterId: "char-1", url: "videos/char-1/abc.mp4" });

    expect(result).toEqual({ characterMediaId: "cm-video-1" });
    expect(prisma.characterMedia.create).toHaveBeenCalledOnce();
    const call = (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.kind).toBe("video");
    expect(call.data.characterId).toBe("char-1");
    expect(call.data.isDisplay).toBe(false);
    expect(call.data.isPrimary).toBe(false);
    expect(backfillCharacterDisplay).not.toHaveBeenCalled();
  });

  it("sets title when provided", async () => {
    const { prisma } = await import("@buttercupp/database");
    const { attachVideoCharacterMedia } = await import("./asset");
    (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cm-video-2" });

    await attachVideoCharacterMedia({ characterId: "char-2", url: "videos/v2.mp4", title: "Summer reel" });

    const call = (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.title).toBe("Summer reel");
  });

  it("omits title from data when not provided", async () => {
    const { prisma } = await import("@buttercupp/database");
    const { attachVideoCharacterMedia } = await import("./asset");
    (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cm-video-3" });

    await attachVideoCharacterMedia({ characterId: "char-3", url: "videos/v3.mp4" });

    const call = (prisma.characterMedia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.title).toBeUndefined();
  });
});
