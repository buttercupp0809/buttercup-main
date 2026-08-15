import { describe, expect, it, vi, beforeEach } from "vitest";

const findManyConversation = vi.fn();
const listCharacters = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: { conversation: { findMany: (...args: unknown[]) => findManyConversation(...args) } },
}));
vi.mock("@/lib/characters", () => ({ listCharacters: (...args: unknown[]) => listCharacters(...args) }));
vi.mock("@/lib/persona-images", () => ({ pickPersonaImage: () => "/personas/1.webp" }));

const { getDashboardFeed } = await import("@/lib/feed");

beforeEach(() => {
  findManyConversation.mockReset();
  listCharacters.mockReset();
  listCharacters.mockResolvedValue({ items: [], nextCursor: null });
});

describe("getDashboardFeed recents (display image ordering)", () => {
  it("orders recents media with isDisplay first, so avatarUrl resolves to the display image", async () => {
    findManyConversation.mockResolvedValue([
      {
        characterId: "char-1",
        character: {
          name: "Aria",
          media: [{ url: "https://cdn.example.com/secondary.jpg" }],
          currentVersion: null,
        },
        lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
        messageCount: 3,
      },
    ]);

    const feed = await getDashboardFeed({ id: "user-1", ageVerified: true });

    expect(feed.recents[0].avatarUrl).toBe("https://cdn.example.com/secondary.jpg");
    const [callArgs] = findManyConversation.mock.calls[0];
    expect(callArgs.include.character.include.media.orderBy).toEqual([
      { isDisplay: "desc" },
      { isPrimary: "desc" },
      { sort: "asc" },
    ]);
  });
});
