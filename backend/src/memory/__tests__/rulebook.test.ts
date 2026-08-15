import { describe, expect, it, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import { getActiveRules, captureRule, _clearRulebookCache } from "../rulebook";
import { dbReachable } from "../../test-utils/db";
import * as provider from "../../llm/provider";

const DB_UP = await dbReachable();

async function makeUserAndCharacter(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `rulebook-${crypto.randomUUID()}@test.local` },
  });
  const character = await prisma.character.create({
    data: {
      name: `Rulebook Test ${suffix}`,
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

describe.skipIf(!DB_UP)("Phase 30 - rulebook", () => {
  const originalFlag = process.env.USER_RULEBOOK_ENABLED;

  afterEach(() => {
    process.env.USER_RULEBOOK_ENABLED = originalFlag;
    _clearRulebookCache();
  });

  it("flag off: getActiveRules returns [] and captureRule is skipped", async () => {
    process.env.USER_RULEBOOK_ENABLED = "false";
    const { user, character } = await makeUserAndCharacter("Off");
    try {
      const rules = await getActiveRules(user.id, character.id);
      expect(rules).toEqual([]);
      const result = await captureRule(user.id, character.id, "start sentences with capital letters", undefined, {
        isRule: true,
        instruction: "Start sentences with capital letters.",
      });
      expect(result.status).toBe("skipped");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("captures a new rule, then reinforces (not duplicates) a near-identical one", async () => {
    process.env.USER_RULEBOOK_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter("Dup");
    try {
      const first = await captureRule(user.id, character.id, "please start sentences with capital letters", undefined, {
        isRule: true,
        instruction: "Start sentences with capital letters.",
      });
      expect(first.status).toBe("created");

      const second = await captureRule(user.id, character.id, "always start sentences with capital letters please", undefined, {
        isRule: true,
        instruction: "Start sentences with capital letters!",
      });
      expect(second.status).toBe("reinforced");

      const rows = await prisma.userRule.findMany({
        where: { userId: user.id, characterId: character.id, status: "active" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].timesReinforced).toBe(2);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("isolation: a rule for (userA, char1) is not returned for (userA, char2)", async () => {
    process.env.USER_RULEBOOK_ENABLED = "true";
    const { user, character: char1 } = await makeUserAndCharacter("Iso1");
    const char2 = await prisma.character.create({
      data: {
        name: "Rulebook Test Iso2",
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
      await captureRule(user.id, char1.id, "never call me dude", undefined, {
        isRule: true,
        instruction: "Never call the user dude.",
      });
      _clearRulebookCache();
      const rulesChar1 = await getActiveRules(user.id, char1.id);
      const rulesChar2 = await getActiveRules(user.id, char2.id);
      expect(rulesChar1).toContain("Never call the user dude.");
      expect(rulesChar2).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("non-rule input is skipped", async () => {
    process.env.USER_RULEBOOK_ENABLED = "true";
    const { user, character } = await makeUserAndCharacter("NonRule");
    // preExtracted only short-circuits the LLM call when isRule is true (see
    // rulebook.ts), so a false classification still falls through to
    // callLLM; mock it here to keep the test hermetic (no live provider).
    const spy = vi.spyOn(provider, "callLLM").mockResolvedValue({
      text: JSON.stringify({ isRule: false, instruction: "" }),
      provider: "test",
      model: "test",
      fallback: false,
    });
    try {
      const result = await captureRule(user.id, character.id, "i love talking to you", undefined, {
        isRule: false,
        instruction: "",
      });
      expect(result.status).toBe("skipped");
    } finally {
      spy.mockRestore();
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});
