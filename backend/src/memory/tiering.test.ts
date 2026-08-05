import { describe, expect, it } from "vitest";
import { classifyTier, CORE_CAP, HOT_ACCESS_THRESHOLD } from "./tiering";
import type { Memory } from "@poppy/database";

function mem(overrides: Partial<Memory>): Memory {
  const now = new Date();
  return {
    id: "m-" + Math.random().toString(36).slice(2, 8),
    userId: "u-1",
    characterId: "c-1",
    content: "test",
    category: "trivia",
    tier: "warm",
    salience: 0.5,
    importance: 0.5,
    confidence: 1.0,
    emotionalValence: 0,
    pinned: false,
    accessCount: 0,
    lastAccessedAt: null,
    validUntil: null,
    sourceMessageId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Memory;
}

describe("classifyTier", () => {
  const now = new Date();

  it("pinned -> hot regardless of other signals", () => {
    expect(classifyTier(mem({ pinned: true, importance: 0.1 }), now)).toBe("hot");
  });

  it("high-importance identity -> hot", () => {
    expect(classifyTier(mem({ category: "identity", importance: 0.95 }), now)).toBe("hot");
  });

  it("frequently accessed recent -> hot", () => {
    expect(
      classifyTier(
        mem({ accessCount: HOT_ACCESS_THRESHOLD + 1, lastAccessedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) }),
        now,
      ),
    ).toBe("hot");
  });

  it("stale + low importance -> cold", () => {
    const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    expect(classifyTier(mem({ createdAt: oldDate, importance: 0.3 }), now)).toBe("cold");
  });

  it("expired validUntil -> cold", () => {
    expect(
      classifyTier(mem({ validUntil: new Date(now.getTime() - 60_000) }), now),
    ).toBe("cold");
  });

  it("default -> warm", () => {
    expect(classifyTier(mem({}), now)).toBe("warm");
  });
});

describe("CORE_CAP", () => {
  it("is 25 to match Pellow's core capacity", () => {
    expect(CORE_CAP).toBe(25);
  });
});
