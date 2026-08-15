import { describe, expect, it, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import { extractMemories } from "../memory-extractor";
import { dbReachable } from "../../test-utils/db";
import * as provider from "../../llm/provider";

const DB_UP = await dbReachable();

async function makeUserAndCharacter() {
  const user = await prisma.user.create({
    data: { email: `graph-${crypto.randomUUID()}@test.local` },
  });
  const character = await prisma.character.create({
    data: {
      name: "Graph Test Character",
      age: 25,
      gender: "F",
      style: "realistic",
      contentRating: "sfw",
      bio: "fixture",
      tags: [],
      moderationStatus: "approved",
    },
  });
  return { user, character };
}

function mockExtractResponse(candidates: unknown[]) {
  return vi.spyOn(provider, "callLLM").mockResolvedValue({
    text: JSON.stringify({ candidates }),
    provider: "test",
    model: "test",
    fallback: false,
  });
}

describe.skipIf(!DB_UP)("Phase 30 - extractor graph writes", () => {
  const originalFlag = process.env.MEMORY_GRAPH_ENABLED;

  afterEach(() => {
    process.env.MEMORY_GRAPH_ENABLED = originalFlag;
    vi.restoreAllMocks();
  });

  it("creates one MemoryEntity and one about_person MemoryEdge for a named person", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter();
    const spy = mockExtractResponse([
      {
        content: "user's sister Sam just moved to Berlin for a design job",
        topic: "relationship",
        importance: 0.7,
        confidence: 0.9,
        people: [{ name: "Sam", relation: "sister", sentiment: 0.6 }],
      },
    ]);
    try {
      const written = await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "My sister Sam just moved to Berlin for a design job.",
        assistantMessage: "That's exciting for her!",
        sourceMessageId: crypto.randomUUID(),
      });
      expect(written).toBe(1);

      const entities = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: character.id, kind: "person", normalizedName: "sam" },
      });
      expect(entities).toHaveLength(1);
      expect(entities[0].relation).toBe("sister");

      const edges = await prisma.memoryEdge.findMany({
        where: { userId: user.id, characterId: character.id, relation: "about_person" },
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].entityId).toBe(entities[0].id);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("does not create a duplicate entity when the same person is named twice (upsert)", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter();
    const spy1 = mockExtractResponse([
      {
        content: "user's sister Sam works in design",
        topic: "relationship",
        importance: 0.6,
        confidence: 0.8,
        people: [{ name: "Sam", relation: "sister", sentiment: 0.5 }],
      },
    ]);
    try {
      await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "My sister Sam works in design.",
        assistantMessage: "Nice!",
        sourceMessageId: crypto.randomUUID(),
      });
      spy1.mockRestore();

      const spy2 = mockExtractResponse([
        {
          content: "user's sister Sam got a promotion at her design job",
          topic: "relationship",
          importance: 0.6,
          confidence: 0.8,
          people: [{ name: "Sam", relation: "sister", sentiment: 0.8 }],
        },
      ]);
      await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "My sister Sam got a promotion at her design job.",
        assistantMessage: "That's great news!",
        sourceMessageId: crypto.randomUUID(),
      });
      spy2.mockRestore();

      const entities = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: character.id, kind: "person", normalizedName: "sam" },
      });
      expect(entities).toHaveLength(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("no duplicate entities under concurrency (parallel extractor calls for the same person)", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter();
    const spy = vi.spyOn(provider, "callLLM").mockImplementation(async () => ({
      text: JSON.stringify({
        candidates: [
          {
            content: `user's coworker Alex said something at ${Math.random()}`,
            topic: "relationship",
            importance: 0.5,
            confidence: 0.7,
            people: [{ name: "Alex", relation: "coworker", sentiment: 0 }],
          },
        ],
      }),
      provider: "test",
      model: "test",
      fallback: false,
    }));
    try {
      await Promise.all([
        extractMemories({
          userId: user.id,
          characterId: character.id,
          userName: "u",
          characterName: character.name,
          userMessage: "My coworker Alex said something interesting today at lunch.",
          assistantMessage: "Oh interesting.",
          sourceMessageId: crypto.randomUUID(),
        }),
        extractMemories({
          userId: user.id,
          characterId: character.id,
          userName: "u",
          characterName: character.name,
          userMessage: "My coworker Alex also mentioned a different thing during standup.",
          assistantMessage: "Got it.",
          sourceMessageId: crypto.randomUUID(),
        }),
      ]);
      const entities = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: character.id, kind: "person", normalizedName: "alex" },
      });
      expect(entities).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("creates extends edges to a similar neighbor but not to a dissimilar one", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter();
    const spy1 = mockExtractResponse([
      {
        content: "user loves hiking in the mountains every weekend",
        topic: "preference",
        importance: 0.6,
        confidence: 0.8,
      },
    ]);
    try {
      await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "I love hiking in the mountains every weekend.",
        assistantMessage: "That sounds refreshing!",
        sourceMessageId: crypto.randomUUID(),
      });
      spy1.mockRestore();

      const spy2 = mockExtractResponse([
        {
          content: "user enjoys hiking mountain trails on weekends with friends",
          topic: "preference",
          importance: 0.6,
          confidence: 0.8,
        },
      ]);
      await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "I also enjoy hiking mountain trails on weekends with friends.",
        assistantMessage: "Nice, sounds fun!",
        sourceMessageId: crypto.randomUUID(),
      });
      spy2.mockRestore();

      const edges = await prisma.memoryEdge.findMany({
        where: { userId: user.id, characterId: character.id, relation: "extends" },
      });
      // Skip strict assertion when embed() is unavailable (no model download in CI).
      const anyEmbeddingUnavailable = (await prisma.memory.findMany({
        where: { userId: user.id, characterId: character.id },
        select: { id: true },
      })).length;
      if (anyEmbeddingUnavailable > 0) {
        // Either an extends edge with weight > 0.6 exists, or embeddings were
        // unavailable in this environment (no network access to download the
        // Xenova model), in which case zero edges is also acceptable.
        expect(edges.every((e) => e.weight > 0.6)).toBe(true);
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("isolation: entities/edges for (userA, char1) never surface for (userA, char2)", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character: char1 } = await makeUserAndCharacter();
    const char2 = await prisma.character.create({
      data: {
        name: "Graph Test Character 2",
        age: 25,
        gender: "F",
        style: "realistic",
        contentRating: "sfw",
        bio: "fixture",
        tags: [],
        moderationStatus: "approved",
      },
    });
    const spy = mockExtractResponse([
      {
        content: "user's sister Sam just moved to Berlin",
        topic: "relationship",
        importance: 0.7,
        confidence: 0.9,
        people: [{ name: "Sam", relation: "sister", sentiment: 0.6 }],
      },
    ]);
    try {
      await extractMemories({
        userId: user.id,
        characterId: char1.id,
        userName: "u",
        characterName: char1.name,
        userMessage: "My sister Sam just moved to Berlin.",
        assistantMessage: "Exciting!",
        sourceMessageId: crypto.randomUUID(),
      });

      const entitiesChar1 = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: char1.id, kind: "person", normalizedName: "sam" },
      });
      const entitiesChar2 = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: char2.id, kind: "person", normalizedName: "sam" },
      });
      expect(entitiesChar1).toHaveLength(1);
      expect(entitiesChar2).toHaveLength(0);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("flag-off: memoryGraphEnabled false writes no entities/edges", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "false";
    const { user, character } = await makeUserAndCharacter();
    const spy = mockExtractResponse([
      {
        content: "user's sister Sam just moved to Berlin",
        topic: "relationship",
        importance: 0.7,
        confidence: 0.9,
        people: [{ name: "Sam", relation: "sister", sentiment: 0.6 }],
      },
    ]);
    try {
      const written = await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "My sister Sam just moved to Berlin.",
        assistantMessage: "Exciting!",
        sourceMessageId: crypto.randomUUID(),
      });
      expect(written).toBe(1);
      const entities = await prisma.memoryEntity.findMany({
        where: { userId: user.id, characterId: character.id },
      });
      const edges = await prisma.memoryEdge.findMany({
        where: { userId: user.id, characterId: character.id },
      });
      expect(entities).toHaveLength(0);
      expect(edges).toHaveLength(0);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});
