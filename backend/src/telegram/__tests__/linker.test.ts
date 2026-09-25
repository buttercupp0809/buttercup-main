import { beforeAll, afterAll, test, expect } from "vitest";
import { prisma } from "@buttercupp/database";
import { consumeLinkToken } from "../linker";

const TEST_USER_ID = "tg-linker-test-user-id";
const TEST_USER_EMAIL = "tg-linker-test@test.invalid";
const TEST_CHAR = "tg-linker-test-char";
const TEST_TG_USER = "123456789";
const TEST_TG_CHAT = "123456789";

beforeAll(async () => {
  // Clean any leftovers from previous runs.
  await prisma.telegramLinkToken.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.telegramUserLink.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });

  // Create a test user so FK constraints pass.
  await prisma.user.create({
    data: { id: TEST_USER_ID, email: TEST_USER_EMAIL },
  });
});

afterAll(async () => {
  await prisma.telegramLinkToken.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.telegramUserLink.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.$disconnect();
});

test("consumeLinkToken rejects expired token", async () => {
  // Insert an already-expired token directly.
  await prisma.telegramLinkToken.create({
    data: {
      token: "expired-token-test",
      userId: TEST_USER_ID,
      characterId: TEST_CHAR,
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const result = await consumeLinkToken("expired-token-test", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_expired");
});

test("consumeLinkToken rejects already-used token", async () => {
  await prisma.telegramLinkToken.create({
    data: {
      token: "used-token-test",
      userId: TEST_USER_ID,
      characterId: TEST_CHAR,
      expiresAt: new Date(Date.now() + 900_000),
      usedAt: new Date(),
    },
  });
  const result = await consumeLinkToken("used-token-test", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_already_used");
});

test("consumeLinkToken rejects unknown token", async () => {
  const result = await consumeLinkToken("nonexistent-token-xyz", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_not_found");
});
