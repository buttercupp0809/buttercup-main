import { prisma } from "@buttercupp/database";
import { sendPhoto } from "./client";
import { logWarn } from "../utils/log";

// BACKEND_URL is the public-facing backend base URL used to construct presigned
// media proxy URLs. Set via BACKEND_URL env var (same as used in media delivery).
function buildMediaUrl(s3Key: string): string {
  const base = process.env.BACKEND_URL ?? "http://localhost:4000";
  return `${base}/api/media?k=${encodeURIComponent(s3Key)}`;
}

// Best-effort: finds any TelegramUserLink for this user+character and pushes
// the generated image as a photo. Called from the media worker after an image
// job completes. Never throws - Telegram delivery failures are logged only.
export async function notifyTelegramImage(
  userId: string,
  characterId: string | null,
  s3Key: string,
): Promise<void> {
  if (!characterId) return;
  try {
    const link = await prisma.telegramUserLink.findUnique({
      where: { userId_characterId: { userId, characterId } },
    });
    if (!link) return;

    const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
    if (!bot) return;

    const photoUrl = buildMediaUrl(s3Key);
    await sendPhoto(bot.botToken, link.telegramChatId, photoUrl);
  } catch (err) {
    logWarn("telegram", "image notify failed", {
      userId,
      characterId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
