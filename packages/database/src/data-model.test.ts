// Integration tests. Run against a LOCAL test DB pointed to by
// TEST_DATABASE_URL. Skipped when TEST_DATABASE_URL is missing so unit-only
// runs stay green in environments without Postgres.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const TEST_URL = process.env.TEST_DATABASE_URL;

const d = TEST_URL ? describe : describe.skip;

let prisma: PrismaClient;

async function truncateAll() {
  // Delete order respects FKs. AuditLog has no FK. Character depends on
  // CharacterVersion (via currentVersionId, SetNull), so break that first.
  await prisma.character.updateMany({ data: { currentVersionId: null } });
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.characterVersion.deleteMany();
  await prisma.appearanceSheet.deleteMany();
  await prisma.voiceProfile.deleteMany();
  await prisma.character.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.memorySummary.deleteMany();
  await prisma.relationshipState.deleteMany();
  await prisma.magicLink.deleteMany();
  await prisma.ageVerification.deleteMany();
  await prisma.tokenLedger.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.crisisEvent.deleteMany();
  await prisma.user.deleteMany();
}

d("data model integration", () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates User, Character, CharacterVersion, Conversation, Message", async () => {
    const user = await prisma.user.create({
      data: { email: `t${Date.now()}@x.dev` },
    });
    const appearance = await prisma.appearanceSheet.create({
      data: { traits: { hair: "black" }, stylePrompt: "s", negativePrompt: "n", referenceImageKeys: [] },
    });
    const voice = await prisma.voiceProfile.create({
      data: { provider: "eleven", voiceId: "v", params: {} },
    });
    const char = await prisma.character.create({
      data: {
        name: `C-${Date.now()}`,
        age: 25,
        gender: "female",
        bio: "b",
        tags: ["t"],
        style: "realistic",
        contentRating: "sfw",
        visibility: "public",
        moderationStatus: "approved",
      },
    });
    const ver = await prisma.characterVersion.create({
      data: {
        characterId: char.id,
        versionNo: 1,
        personality: "p",
        backstory: "b",
        behavioralInstructions: "i",
        greeting: "g",
        systemPromptSnapshot: "sp",
        appearanceSheetId: appearance.id,
        voiceProfileId: voice.id,
      },
    });
    await prisma.character.update({ where: { id: char.id }, data: { currentVersionId: ver.id } });

    const conv = await prisma.conversation.create({
      data: { userId: user.id, characterId: char.id, characterVersionId: ver.id },
    });
    const msg = await prisma.message.create({
      data: { conversationId: conv.id, role: "user", content: "hi" },
    });

    expect(msg.conversationId).toBe(conv.id);
  });

  it("round-trips every user-facing enum", async () => {
    const user = await prisma.user.create({
      data: {
        email: `enum${Date.now()}@x.dev`,
        subscriptionTier: "premium",
        ageVerificationLevel: "self_declared",
      },
    });
    const reload = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reload?.subscriptionTier).toBe("premium");
    expect(reload?.ageVerificationLevel).toBe("self_declared");

    const media = await prisma.mediaAsset.create({
      data: { userId: user.id, kind: "image", status: "queued" },
    });
    expect(media.status).toBe("queued");

    await prisma.tokenLedger.create({
      data: { userId: user.id, delta: 10, reason: "grant", balanceAfter: 10 },
    });
    const ledger = await prisma.tokenLedger.findFirst({ where: { userId: user.id } });
    expect(ledger?.reason).toBe("grant");
  });

  it("pgvector similarity: nearest row wins on cosine distance", async () => {
    const user = await prisma.user.create({ data: { email: `vec${Date.now()}@x.dev` } });
    const character = await prisma.character.create({
      data: {
        name: `VecChar-${Date.now()}`,
        age: 25,
        gender: "female",
        bio: "b",
        tags: [],
        style: "realistic",
      },
    });
    const dim = 384;
    const vecA = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0));
    const vecB = Array.from({ length: dim }, (_, i) => (i === 1 ? 1 : 0));
    const query = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0));
    const litA = `[${vecA.join(",")}]`;
    const litB = `[${vecB.join(",")}]`;
    const litQ = `[${query.join(",")}]`;

    const memAId = crypto.randomUUID();
    const memBId = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Memory" (id, "userId", "characterId", content, category, embedding, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6::vector,NOW())`,
      memAId, user.id, character.id, "closer", "test", litA,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Memory" (id, "userId", "characterId", content, category, embedding, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6::vector,NOW())`,
      memBId, user.id, character.id, "farther", "test", litB,
    );

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Memory" WHERE "userId" = $1 ORDER BY embedding <=> $2::vector LIMIT 1`,
      user.id, litQ,
    );
    expect(rows[0]?.id).toBe(memAId);
  });

  it("HNSW vector indexes exist", async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('memory_embedding_idx','memory_summary_embedding_idx')`,
    );
    const names = rows.map((r) => r.indexname).sort();
    expect(names).toEqual(["memory_embedding_idx", "memory_summary_embedding_idx"]);
  });

  it("MagicLink hash + single-use round-trip", async () => {
    const user = await prisma.user.create({ data: { email: `ml${Date.now()}@x.dev` } });
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    const link = await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const found = await prisma.magicLink.findUnique({ where: { tokenHash: hash } });
    expect(found?.id).toBe(link.id);

    // consume atomically
    const consumed = await prisma.magicLink.updateMany({
      where: { id: link.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    expect(consumed.count).toBe(1);
    const second = await prisma.magicLink.updateMany({
      where: { id: link.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    expect(second.count).toBe(0);
  });
});
