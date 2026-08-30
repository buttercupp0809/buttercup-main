// Unit tests for the gallery client.
//
// Mocks @buttercupp/database so no live DB is required.
// Verifies that listGalleryImages queries CharacterMedia for non-hidden image
// rows and returns their url values.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterMedia: {
      findMany: vi.fn(),
    },
  },
}));

const { listGalleryImages } = await import("./gallery");

describe("listGalleryImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns url values for ready image rows", async () => {
    const { prisma } = await import("@buttercupp/database");
    const mockFind = prisma.characterMedia.findMany as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue([
      { url: "images/char/a.png" },
      { url: "images/char/b.png" },
    ]);

    const keys = await listGalleryImages("char-1");

    expect(keys).toEqual(["images/char/a.png", "images/char/b.png"]);
  });

  it("queries with correct filters", async () => {
    const { prisma } = await import("@buttercupp/database");
    const mockFind = prisma.characterMedia.findMany as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue([]);

    await listGalleryImages("char-42");

    expect(mockFind).toHaveBeenCalledOnce();
    const [args] = mockFind.mock.calls[0] as [Parameters<typeof prisma.characterMedia.findMany>[0]];
    expect(args?.where).toMatchObject({
      characterId: "char-42",
      kind: "image",
      hidden: false,
    });
  });

  it("returns empty array when no images exist", async () => {
    const { prisma } = await import("@buttercupp/database");
    const mockFind = prisma.characterMedia.findMany as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue([]);

    const keys = await listGalleryImages("empty-char");
    expect(keys).toEqual([]);
  });

  it("includes https:// URLs as-is", async () => {
    const { prisma } = await import("@buttercupp/database");
    const mockFind = prisma.characterMedia.findMany as ReturnType<typeof vi.fn>;
    mockFind.mockResolvedValue([
      { url: "https://cdn.example.com/char/face.jpg" },
    ]);

    const keys = await listGalleryImages("char-cdn");
    expect(keys).toEqual(["https://cdn.example.com/char/face.jpg"]);
  });
});
