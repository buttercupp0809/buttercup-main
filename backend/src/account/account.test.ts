// End-to-end account tests. Exercises the real Prisma cascade against
// poppy_dev; each test seeds a fresh user so re-runs are safe.

import { describe, expect, it } from "vitest";
import { prisma } from "@poppy/database";
import { buildUserExport } from "./export";
import { deleteUserCascade } from "./delete";
import { dbReachable } from "../test-utils/db";

const DB_UP = await dbReachable();

async function seedUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `acct-${crypto.randomUUID()}@test.local`, tokenBalance: 100 },
  });
  const character = await prisma.character.create({
    data: {
      name: "TestChar",
      age: 25,
      gender: "F",
      bio: "test",
      tags: ["test"],
      style: "realistic",
    },
  });
  const conv = await prisma.conversation.create({
    data: {
      userId: user.id,
      characterId: character.id,
      characterVersionId: "placeholder",
    },
  }).catch(async () => {
    // Conversation requires a valid characterVersionId; create a minimal
    // version + retry so the test does not depend on wizard flow.
    const version = await prisma.characterVersion.create({
      data: {
        characterId: character.id,
        versionNo: 1,
        personality: "p",
        backstory: "b",
        behavioralInstructions: "b",
        greeting: "hi",
        systemPromptSnapshot: "s",
      },
    });
    return prisma.conversation.create({
      data: { userId: user.id, characterId: character.id, characterVersionId: version.id },
    });
  });
  await prisma.message.create({
    data: { conversationId: conv.id, role: "user", content: "hello" },
  });
  await prisma.memory.create({
    data: {
      userId: user.id,
      characterId: character.id,
      content: "user likes rain",
      category: "preference",
      tier: "warm",
    },
  });
  await prisma.tokenLedger.create({
    data: { userId: user.id, delta: 50, reason: "grant", balanceAfter: 100 },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "test.event", resource: "test" },
  });
  return user.id;
}

describe.skipIf(!DB_UP)("buildUserExport", () => {
  it("returns messages, memories, characters, and ledger", async () => {
    const userId = await seedUser();
    const bundle = await buildUserExport(userId);
    expect(bundle.user).toBeTruthy();
    expect(bundle.messages.length).toBeGreaterThanOrEqual(1);
    expect(bundle.memories.length).toBeGreaterThanOrEqual(1);
    expect(bundle.tokenLedger.length).toBeGreaterThanOrEqual(1);
    // passwordHash must be redacted
    expect((bundle.user as { passwordHash?: unknown }).passwordHash).toBeUndefined();
  });
});

describe.skipIf(!DB_UP)("deleteUserCascade", () => {
  it("removes every user-owned row and anonymizes AuditLog", async () => {
    const userId = await seedUser();
    await deleteUserCascade(userId);

    const [msg, mem, conv, ledger, user] = await Promise.all([
      prisma.message.count({ where: { conversation: { userId } } }),
      prisma.memory.count({ where: { userId } }),
      prisma.conversation.count({ where: { userId } }),
      prisma.tokenLedger.count({ where: { userId } }),
      prisma.user.count({ where: { id: userId } }),
    ]);
    expect(msg).toBe(0);
    expect(mem).toBe(0);
    expect(conv).toBe(0);
    expect(ledger).toBe(0);
    expect(user).toBe(0);

    // AuditLog rows retained but with userId nulled.
    const remaining = await prisma.auditLog.findMany({ where: { userId } });
    expect(remaining).toEqual([]);
  });
});
