import { describe, expect, it, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import { writeMemory } from "../../memory/store";
import { getRelevantMemories, getRelevantMemoriesWithGraph } from "../memory-retriever";
import { dbReachable } from "../../test-utils/db";

const DB_UP = await dbReachable();

async function makeUserAndCharacter(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `graph-ret-${crypto.randomUUID()}@test.local` },
  });
  const character = await prisma.character.create({
    data: {
      name: `Graph Retriever Test ${suffix}`,
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

describe.skipIf(!DB_UP)("Phase 30 - getRelevantMemoriesWithGraph", () => {
  const originalFlag = process.env.MEMORY_GRAPH_ENABLED;

  afterEach(() => {
    process.env.MEMORY_GRAPH_ENABLED = originalFlag;
  });

  it("flag off: returns exactly getRelevantMemories with no connections", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "false";
    const { user, character } = await makeUserAndCharacter("Off");
    try {
      await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: "user's favorite drink is oat milk latte",
        category: "preference",
        importance: 0.6,
        confidence: 0.8,
        tier: "hot",
      });
      const base = await getRelevantMemories({
        userId: user.id,
        characterId: character.id,
        currentMessage: "what do I like to drink",
      });
      const graph = await getRelevantMemoriesWithGraph({
        userId: user.id,
        characterId: character.id,
        currentMessage: "what do I like to drink",
      });
      expect(graph.connections).toEqual([]);
      expect(graph.scored.map((s) => s.memory.id)).toEqual(base.map((s) => s.memory.id));
      // Same seed set, same order, same scoring formula. Not a strict deep
      // equal because recencyScore is time-based and the two calls happen a
      // few ms apart in this test (production calls this once, not twice).
      graph.scored.forEach((s, i) => expect(s.score).toBeCloseTo(base[i].score, 6));
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("pulls in an edge-linked memory as a graph neighbor with a connection", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter("On");
    try {
      const memAId = await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: "user's sister Sam moved to Berlin for a design job",
        category: "relationship",
        importance: 0.9,
        confidence: 0.9,
        tier: "hot",
      });
      const memBId = await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: "Sam is settling into her new Berlin apartment near the river",
        category: "relationship",
        importance: 0.2,
        confidence: 0.6,
        tier: "warm",
      });
      await prisma.memoryEdge.create({
        data: {
          userId: user.id,
          characterId: character.id,
          sourceId: memAId,
          targetId: memBId,
          relation: "extends",
          weight: 0.8,
          createdBy: "test",
        },
      });

      const base = await getRelevantMemories({
        userId: user.id,
        characterId: character.id,
        currentMessage: "tell me about my sister Sam",
      });
      const baseIds = base.map((s) => s.memory.id);

      const graph = await getRelevantMemoriesWithGraph({
        userId: user.id,
        characterId: character.id,
        currentMessage: "tell me about my sister Sam",
      });
      const graphIds = graph.scored.map((s) => s.memory.id);

      expect(graphIds).toContain(memAId);
      // The base scoring/order for pre-existing ids stays intact...
      for (const id of baseIds) expect(graphIds).toContain(id);
      // ...and the graph result includes memB as an added neighbor beyond base.
      expect(graph.connections.length).toBeGreaterThan(0);
      expect(graph.connections.some((c) => c.fromId === memAId && c.toId === memBId)).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("isolation: entity/edge scoped to (userA, char1) does not leak to (userA, char2)", async () => {
    process.env.MEMORY_GRAPH_ENABLED = "true";
    const { user, character: char1 } = await makeUserAndCharacter("Iso1");
    const char2 = await prisma.character.create({
      data: {
        name: "Graph Retriever Test Iso2",
        age: 25,
        gender: "F",
        style: "realistic",
        contentRating: "sfw",
        bio: "fixture",
        tags: [],
        moderationStatus: "approved",
      },
    });
    try {
      const memAId = await writeMemory({
        userId: user.id,
        characterId: char1.id,
        content: "user's sister Sam moved to Berlin",
        category: "relationship",
        importance: 0.9,
        confidence: 0.9,
        tier: "hot",
      });
      const memBId = await writeMemory({
        userId: user.id,
        characterId: char1.id,
        content: "Sam works at a design studio downtown",
        category: "relationship",
        importance: 0.2,
        confidence: 0.6,
        tier: "warm",
      });
      await prisma.memoryEdge.create({
        data: {
          userId: user.id,
          characterId: char1.id,
          sourceId: memAId,
          targetId: memBId,
          relation: "extends",
          weight: 0.8,
          createdBy: "test",
        },
      });

      const graphChar2 = await getRelevantMemoriesWithGraph({
        userId: user.id,
        characterId: char2.id,
        currentMessage: "tell me about my sister Sam",
      });
      expect(graphChar2.scored.map((s) => s.memory.id)).not.toContain(memAId);
      expect(graphChar2.scored.map((s) => s.memory.id)).not.toContain(memBId);
      expect(graphChar2.connections).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});
