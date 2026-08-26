import { describe, expect, it, vi } from "vitest";
import type { CharacterWithCurrent } from "@/lib/characters";
import { appearanceChanged } from "@/lib/character-appearance";

const findUniqueCharacter = vi.fn();
const aggregateCharacterVersion = vi.fn();
vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: { findUnique: (...args: unknown[]) => findUniqueCharacter(...args) },
  },
  buildCharacterWhere: vi.fn(),
  buildCharacterOrderBy: vi.fn(),
  // getCharacterDetail imports the shared media ordering; expose it in the mock.
  CHARACTER_MEDIA_ORDER_BY: [
    { isMain: "desc" },
    { isDisplay: "desc" },
    { isPrimary: "desc" },
    { sort: "asc" },
  ],
}));

const { topTagsFrom, primaryImageFrom, toCard, getCharacterDetail, nextVersionNo } =
  await import("@/lib/characters");

// Fake Prisma.TransactionClient slice: nextVersionNo only touches
// characterVersion.aggregate, so this is all it needs to satisfy the
// `Pick<Prisma.TransactionClient, "characterVersion">` parameter type.
const fakeTx = {
  characterVersion: { aggregate: (...args: unknown[]) => aggregateCharacterVersion(...args) },
} as unknown as Parameters<typeof nextVersionNo>[0];

describe("topTagsFrom", () => {
  it("returns [] for empty input", () => {
    expect(topTagsFrom([])).toEqual([]);
  });

  it("counts, dedupes, and caps to limit", () => {
    const lists = [
      ["romance", "sci-fi", "romance"],
      ["romance", "mystery"],
      ["sci-fi", "mystery", "mystery"],
    ];
    const top = topTagsFrom(lists, 2);
    // romance:3, mystery:3, sci-fi:2 -> ties broken alphabetically
    expect(top).toEqual(["mystery", "romance"]);
  });

  it("trims and drops empty strings", () => {
    const top = topTagsFrom([["  cozy  ", ""], [" cozy"]]);
    expect(top).toEqual(["cozy"]);
  });

  it("ignores non-array entries defensively", () => {
    const top = topTagsFrom([
      ["a"],
      undefined as unknown as string[],
      ["a", "b"],
    ]);
    expect(top).toEqual(["a", "b"]);
  });
});

describe("primaryImageFrom (display image resolution)", () => {
  it("returns the isDisplay image, not the isPrimary hero, given a two-image row set", () => {
    const media = [
      { id: "m1", url: "https://cdn.example.com/hero.jpg", kind: "image", isPrimary: true, isDisplay: false },
      { id: "m2", url: "https://cdn.example.com/secondary.jpg", kind: "image", isPrimary: false, isDisplay: true },
    ];
    expect(primaryImageFrom(media)).toBe("https://cdn.example.com/secondary.jpg");
  });

  it("falls back to the first image when no row is isDisplay (pre-backfill data)", () => {
    const media = [
      { id: "m1", url: "https://cdn.example.com/only.jpg", kind: "image", isPrimary: true, isDisplay: false },
    ];
    expect(primaryImageFrom(media)).toBe("https://cdn.example.com/only.jpg");
  });

  it("returns null when there is no image media", () => {
    expect(primaryImageFrom(undefined)).toBeNull();
    expect(primaryImageFrom([])).toBeNull();
  });
});

describe("toCard (avatarUrl resolution)", () => {
  function fixtureRow(media: CharacterWithCurrent["media"]): CharacterWithCurrent {
    return {
      id: "char-1",
      name: "Aria",
      bio: "bio",
      tags: ["warm"],
      style: "realistic",
      contentRating: "sfw",
      popularityScore: 10,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      currentVersion: null,
      media,
    } as unknown as CharacterWithCurrent;
  }

  it("avatarUrl resolves to the isDisplay image, not the isPrimary hero", () => {
    const row = fixtureRow([
      { id: "m1", url: "https://cdn.example.com/hero.jpg", kind: "image", isPrimary: true, isDisplay: false },
      { id: "m2", url: "https://cdn.example.com/secondary.jpg", kind: "image", isPrimary: false, isDisplay: true },
    ]);
    expect(toCard(row).avatarUrl).toBe("https://cdn.example.com/secondary.jpg");
  });
});

describe("getCharacterDetail (gallery excludes the display asset)", () => {
  it("galleryImages contains the hero (non-display) image and does NOT contain the display image", async () => {
    findUniqueCharacter.mockResolvedValue({
      id: "char-1",
      name: "Aria",
      bio: "bio",
      tags: [],
      style: "realistic",
      contentRating: "sfw",
      popularityScore: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerUserId: null,
      visibility: "public",
      moderationStatus: "approved",
      currentVersion: { greeting: "hi", personality: "p", id: "v1", versionNo: 1, createdAt: new Date() },
      media: [
        { url: "https://cdn.example.com/secondary.jpg", kind: "image", isPrimary: false, isDisplay: true },
        { url: "https://cdn.example.com/hero.jpg", kind: "image", isPrimary: true, isDisplay: false },
      ],
    });

    const detail = await getCharacterDetail("char-1", { id: "viewer-1", ageVerified: true });

    expect(detail?.avatarUrl).toBe("https://cdn.example.com/secondary.jpg");
    expect(detail?.galleryImages).toEqual(["https://cdn.example.com/hero.jpg"]);
    expect(detail?.galleryImages).not.toContain("https://cdn.example.com/secondary.jpg");
  });

  it("drops a gallery entry whose underlying key filename matches the avatar's (byte-identical seed images under different owner prefixes)", async () => {
    // The seed data bug: two different CharacterMedia rows point to
    // byte-identical PNGs at different owner-prefixed S3 keys. Full-URL
    // string dedup misses this because the keys differ; identity-based
    // dedup (last path segment) catches it. This is the case the previous
    // fix failed to cover.
    findUniqueCharacter.mockResolvedValue({
      id: "char-3",
      name: "Ariana",
      bio: "bio",
      tags: [],
      style: "realistic",
      contentRating: "sfw",
      popularityScore: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerUserId: null,
      visibility: "public",
      moderationStatus: "approved",
      currentVersion: { greeting: "hi", personality: "p", id: "v1", versionNo: 1, createdAt: new Date() },
      media: [
        // isDisplay row uses ownerA prefix.
        {
          url: "character-media/ownerA/juggernaut-1-p1-v1.png",
          kind: "image",
          isPrimary: false,
          isDisplay: true,
        },
        // isPrimary row: DIFFERENT owner prefix but SAME filename (byte-
        // identical PNG). Legacy dedup missed this; identity-based dedup
        // must drop it.
        {
          url: "character-media/ownerB/juggernaut-1-p1-v1.png",
          kind: "image",
          isPrimary: true,
          isDisplay: false,
        },
        {
          url: "character-media/ownerA/juggernaut-1-p2-v1.png",
          kind: "image",
          isPrimary: false,
          isDisplay: false,
        },
      ],
    });

    const detail = await getCharacterDetail("char-3", { id: "viewer-1", ageVerified: true });

    expect(detail?.galleryImages).toEqual([
      "/api/media?k=character-media%2FownerA%2Fjuggernaut-1-p2-v1.png",
    ]);
    // The duplicate under ownerB must NOT appear in the gallery.
    expect(detail?.galleryImages).not.toEqual(
      expect.arrayContaining([
        "/api/media?k=character-media%2FownerB%2Fjuggernaut-1-p1-v1.png",
      ]),
    );
  });

  it("does not duplicate the avatarUrl into galleryImages when no row is isDisplay (pre-backfill fallback)", async () => {
    // Pre-backfill row set: no isDisplay flag set anywhere. primaryImageFrom
    // falls back to the first image, and the naive gallery filter (!isDisplay)
    // would otherwise return every image, so index 0 of the gallery would be
    // the exact same URL as the hero avatar. Verify the extra guard drops it.
    findUniqueCharacter.mockResolvedValue({
      id: "char-2",
      name: "Nova",
      bio: "bio",
      tags: [],
      style: "realistic",
      contentRating: "sfw",
      popularityScore: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerUserId: null,
      visibility: "public",
      moderationStatus: "approved",
      currentVersion: { greeting: "hi", personality: "p", id: "v1", versionNo: 1, createdAt: new Date() },
      media: [
        { url: "https://cdn.example.com/a.jpg", kind: "image", isPrimary: true, isDisplay: false },
        { url: "https://cdn.example.com/b.jpg", kind: "image", isPrimary: false, isDisplay: false },
      ],
    });

    const detail = await getCharacterDetail("char-2", { id: "viewer-1", ageVerified: true });

    expect(detail?.avatarUrl).toBe("https://cdn.example.com/a.jpg");
    expect(detail?.galleryImages).not.toContain("https://cdn.example.com/a.jpg");
    expect(detail?.galleryImages).toEqual(["https://cdn.example.com/b.jpg"]);
  });
});

describe("nextVersionNo (Build step 6: single version-number source of truth)", () => {
  it("returns 1 for a brand-new character with no prior versions", async () => {
    aggregateCharacterVersion.mockResolvedValue({ _max: { versionNo: null } });
    await expect(nextVersionNo(fakeTx, "char-new")).resolves.toBe(1);
    expect(aggregateCharacterVersion).toHaveBeenCalledWith({
      where: { characterId: "char-new" },
      _max: { versionNo: true },
    });
  });

  it("returns max(versionNo) + 1 for a character with existing versions", async () => {
    aggregateCharacterVersion.mockResolvedValue({ _max: { versionNo: 3 } });
    await expect(nextVersionNo(fakeTx, "char-existing")).resolves.toBe(4);
  });
});

describe("appearanceChanged (edit-mode regeneration gate)", () => {
  const original = {
    style: "realistic" as const,
    traits: { hair: "black" },
    stylePrompt: "a photo of a woman",
    negativePrompt: "blurry",
    referenceImageKeys: ["key-1"],
    name: "Aria",
  };

  it("returns false when nothing appearance-affecting changed", () => {
    expect(appearanceChanged(original, { ...original, name: "Aria V2" })).toBe(false);
  });

  it("returns true when stylePrompt changed", () => {
    expect(appearanceChanged(original, { ...original, stylePrompt: "a photo of a man" })).toBe(true);
  });

  it("returns true when traits changed", () => {
    expect(appearanceChanged(original, { ...original, traits: { hair: "blonde" } })).toBe(true);
  });

  it("returns true when referenceImageKeys changed", () => {
    expect(appearanceChanged(original, { ...original, referenceImageKeys: ["key-1", "key-2"] })).toBe(
      true,
    );
  });

  it("returns false when there is no original draft (create mode)", () => {
    expect(appearanceChanged(null, original)).toBe(false);
  });
});
