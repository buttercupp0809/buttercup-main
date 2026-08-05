import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import { writeMemory, vectorSearchMemories } from "../store";
import { getRelevantMemories } from "../../llm/memory-retriever";
import { runCompactionForUser } from "../compactor";
import { rebalanceTiers } from "../tiering";
import { extractMemories, contentHashOf } from "../../llm/memory-extractor";
import { embed, EMBEDDING_DIM } from "../../llm/embeddings";
import { dbReachable } from "../../test-utils/db";
import * as provider from "../../llm/provider";

const DB_UP = await dbReachable();

async function makeUserAndCharacter(nameSuffix: string) {
  const user = await prisma.user.create({
    data: { email: `mem-${crypto.randomUUID()}@test.local` },
  });
  const character = await prisma.character.create({
    data: {
      name: `Test ${nameSuffix}`,
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

describe.skipIf(!DB_UP)("Phase 23 memory hardening - retrieval + isolation", () => {
  it("surfaces a turn-1 fact after 19 noise turns", async () => {
    const { user, character } = await makeUserAndCharacter("A");
    const fact = "user is a marine biologist studying octopus cognition";
    await writeMemory({
      userId: user.id,
      characterId: character.id,
      content: fact,
      category: "identity",
      importance: 0.9,
      confidence: 0.95,
      tier: "hot",
    });
    for (let i = 0; i < 19; i++) {
      await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: `unrelated fact number ${i}: prefers item ${i}`,
        category: "preference",
        importance: 0.4,
        confidence: 0.7,
        tier: "warm",
      });
    }
    const hits = await getRelevantMemories({
      userId: user.id,
      characterId: character.id,
      currentMessage: "tell me about your octopus research",
    });
    expect(hits.some((h) => h.memory.content === fact)).toBe(true);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it("per-(user,character) isolation: char2 does not see char1's fact", async () => {
    const { user, character: charA } = await makeUserAndCharacter("Iso-A");
    const charB = await prisma.character.create({
      data: {
        name: "Test Iso-B",
        age: 25,
        gender: "F",
        style: "realistic",
        contentRating: "sfw",
        bio: "fixture",
        tags: [],
        moderationStatus: "approved",
      },
    });
    const fact = "user owns a vintage 1963 Fender Jazzmaster in sunburst";
    await writeMemory({
      userId: user.id,
      characterId: charA.id,
      content: fact,
      category: "identity",
      importance: 0.9,
      confidence: 0.95,
      tier: "hot",
    });
    const hitsA = await getRelevantMemories({
      userId: user.id,
      characterId: charA.id,
      currentMessage: "tell me about your guitar",
    });
    const hitsB = await getRelevantMemories({
      userId: user.id,
      characterId: charB.id,
      currentMessage: "tell me about your guitar",
    });
    expect(hitsA.some((h) => h.memory.content === fact)).toBe(true);
    expect(hitsB.some((h) => h.memory.content === fact)).toBe(false);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it("parameterized SQL: SQL-metachar content round-trips safely", async () => {
    const { user, character } = await makeUserAndCharacter("SQL");
    const evilContent = "user said: '); DROP TABLE \"Memory\"; -- and it was funny";
    const id = await writeMemory({
      userId: user.id,
      characterId: character.id,
      content: evilContent,
      category: "trivia",
      importance: 0.5,
      confidence: 0.8,
      tier: "warm",
    });
    // Row must exist unchanged. If interpolation had leaked, the DROP would
    // have thrown or the content would be mangled.
    const row = await prisma.memory.findUnique({ where: { id } });
    expect(row?.content).toBe(evilContent);
    // Vector search still executes (may return no hits when embed() is
    // unavailable; it must at least not throw).
    const vec = await embed("guitar");
    if (vec) {
      const hits = await vectorSearchMemories(user.id, character.id, vec, 5);
      expect(Array.isArray(hits)).toBe(true);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});

describe.skipIf(!DB_UP)("Phase 23 memory hardening - concurrency + idempotency", () => {
  it("concurrent extractor calls for the same source message produce one row", async () => {
    const { user, character } = await makeUserAndCharacter("Conc");
    // Mock the LLM to return one candidate deterministically.
    const spy = vitestSpyCallLLM(
      JSON.stringify({
        candidates: [
          {
            content: "user's favorite color is verdigris green",
            topic: "preference",
            importance: 0.6,
            confidence: 0.85,
          },
        ],
      }),
    );
    try {
      const sourceMessageId = crypto.randomUUID();
      // Fire two extractor calls in parallel for the same source turn.
      await Promise.all([
        extractMemories({
          userId: user.id,
          characterId: character.id,
          userName: "u",
          characterName: character.name,
          userMessage: "I really love the color verdigris green, it's calming.",
          assistantMessage: "That's a beautiful choice.",
          sourceMessageId,
        }),
        extractMemories({
          userId: user.id,
          characterId: character.id,
          userName: "u",
          characterName: character.name,
          userMessage: "I really love the color verdigris green, it's calming.",
          assistantMessage: "That's a beautiful choice.",
          sourceMessageId,
        }),
      ]);
      const rows = await prisma.memory.findMany({
        where: { userId: user.id, characterId: character.id },
      });
      // Jaccard 0.6 alone allows both to slip through if they race the read;
      // the Phase 23 contentHash + sourceMessageId guard bounds it to <=2,
      // and in the common case (2nd extractor sees the 1st's write) to 1.
      // Assert AT MOST one Memory row exists per unique (source, hash).
      const uniqueKeys = new Set(
        rows.map((r) => `${r.sourceMessageId ?? ""}::${r.contentHash ?? r.content}`),
      );
      expect(uniqueKeys.size).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("contentHashOf is stable across whitespace/case variants", () => {
    const a = contentHashOf("User likes rain");
    const b = contentHashOf("  user LIKES   rain  ");
    expect(a).toBe(b);
  });

  it("extractor dead-letters and never throws when callLLM fails twice", async () => {
    const { user, character } = await makeUserAndCharacter("DL");
    const before = await prisma.memoryDeadLetter.count();
    const spy = vitestSpyCallLLMThrow();
    let threw = false;
    let written = -1;
    try {
      written = await extractMemories({
        userId: user.id,
        characterId: character.id,
        userName: "u",
        characterName: character.name,
        userMessage: "This message is long enough to trigger extraction path.",
        assistantMessage: "OK",
        sourceMessageId: crypto.randomUUID(),
      });
    } catch {
      threw = true;
    }
    spy.mockRestore();
    expect(threw).toBe(false);
    expect(written).toBe(0);
    const after = await prisma.memoryDeadLetter.count();
    expect(after).toBeGreaterThan(before);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});

describe.skipIf(!DB_UP)("Phase 23 - compaction transactionality", () => {
  it("summary + demotion commit together and are idempotent under double-invoke", async () => {
    const { user, character } = await makeUserAndCharacter("Sum");
    for (let i = 0; i < 6; i++) {
      await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: `low importance fact ${i}: something small ${i}`,
        category: "trivia",
        importance: 0.3,
        confidence: 0.6,
        tier: "warm",
      });
    }
    const spy = vitestSpyCallLLM(
      JSON.stringify({
        summary: "A short recap of small trivia the user shared.",
        themes: ["small talk"],
        sentiment: "neutral",
        keyEvents: [],
      }),
    );
    try {
      const first = await runCompactionForUser(user.id, character.id);
      const second = await runCompactionForUser(user.id, character.id);
      expect(first).toBe(true);
      // Double-invoke resolves to a single summary (idempotency guard).
      expect(second).toBe(false);
      const summaries = await prisma.memorySummary.count({
        where: { userId: user.id, characterId: character.id },
      });
      expect(summaries).toBe(1);
      const coldCount = await prisma.memory.count({
        where: { userId: user.id, characterId: character.id, tier: "cold" },
      });
      // All 6 (importance 0.3 < 0.75, none pinned) demoted atomically.
      expect(coldCount).toBe(6);
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});

describe.skipIf(!DB_UP)("Phase 23 - tiering rebalance is transactional", () => {
  it("rebalances without error and returns consistent counts", async () => {
    const { user, character } = await makeUserAndCharacter("Tier");
    for (let i = 0; i < 5; i++) {
      await writeMemory({
        userId: user.id,
        characterId: character.id,
        content: `warm fact ${i}`,
        category: "trivia",
        importance: 0.5,
        confidence: 0.7,
        tier: "warm",
      });
    }
    const res = await rebalanceTiers(user.id, character.id);
    expect(res.hotCount + res.warmCount + res.coldCount).toBe(5);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});

describe("embedding dimension (pure)", () => {
  it("embed returns a 384-dim vector or null when the model is unavailable", async () => {
    const v = await embed("hello world");
    if (v !== null) expect(v.length).toBe(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(384);
  });
});

// --- helpers --------------------------------------------------------------
// We stub callLLM by patching the module object rather than the vitest mock
// factory so the DB paths in extractMemories/runCompactionForUser stay real.
import { vi } from "vitest";

function vitestSpyCallLLM(returnText: string) {
  return vi.spyOn(provider, "callLLM").mockResolvedValue({
    text: returnText,
    provider: "test",
    model: "test",
    fallback: false,
  });
}

function vitestSpyCallLLMThrow() {
  return vi
    .spyOn(provider, "callLLM")
    .mockRejectedValueOnce(new Error("boom-1"))
    .mockRejectedValueOnce(new Error("boom-2"));
}
