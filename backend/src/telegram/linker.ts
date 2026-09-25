import { randomBytes } from "node:crypto";
import { prisma } from "@buttercupp/database";
import type { TelegramUserLink } from "@buttercupp/database";
import { logInfo } from "../utils/log";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function generateLinkToken(
  userId: string,
  characterId: string,
): Promise<{ token: string; botUsername: string; deepLink: string }> {
  const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
  if (!bot) throw new Error("no_bot_configured_for_character");

  const token = randomBytes(24).toString("hex");
  await prisma.telegramLinkToken.create({
    data: {
      token,
      userId,
      characterId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const deepLink = `https://t.me/${bot.botUsername}?start=${token}`;
  logInfo("telegram", `link token minted for user=${userId} char=${characterId}`);
  return { token, botUsername: bot.botUsername, deepLink };
}

export async function consumeLinkToken(
  token: string,
  telegramUserId: string,
  telegramChatId: string,
  username?: string,
): Promise<
  | { ok: true; characterId: string; userId: string }
  | { ok: false; reason: string }
> {
  const row = await prisma.telegramLinkToken.findUnique({ where: { token } });
  if (!row) return { ok: false, reason: "token_not_found" };
  if (row.usedAt) return { ok: false, reason: "token_already_used" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "token_expired" };

  // Mark used and upsert the link atomically.
  await prisma.$transaction([
    prisma.telegramLinkToken.update({
      where: { token },
      data: { usedAt: new Date() },
    }),
    prisma.telegramUserLink.upsert({
      where: {
        userId_characterId: { userId: row.userId, characterId: row.characterId },
      },
      create: {
        userId: row.userId,
        characterId: row.characterId,
        telegramUserId,
        telegramChatId,
        username: username ?? null,
      },
      update: {
        telegramUserId,
        telegramChatId,
        username: username ?? null,
        linkedAt: new Date(),
      },
    }),
  ]);

  logInfo("telegram", `account linked user=${row.userId} char=${row.characterId} tg=${telegramUserId}`);
  return { ok: true, characterId: row.characterId, userId: row.userId };
}

export async function getTelegramLink(
  userId: string,
  characterId: string,
): Promise<TelegramUserLink | null> {
  return prisma.telegramUserLink.findUnique({
    where: { userId_characterId: { userId, characterId } },
  });
}

export async function removeTelegramLink(userId: string, characterId: string): Promise<void> {
  await prisma.telegramUserLink.deleteMany({
    where: { userId, characterId },
  });
  logInfo("telegram", `account unlinked user=${userId} char=${characterId}`);
}
