// Telegram message handler. Routes incoming Telegram messages to the existing
// chat engine (runChatTurn) or image generation (generateChatImage), mirroring
// the in-app experience as closely as possible.
//
// Entitlement checks follow the same logic as the WebSocket / SSE transports:
//   - Free users: consumeFirstFreeImage gates the lifetime first-image slot;
//     on subsequent image requests assertCanTease decides generate-vs-paywall.
//   - Paid users: generate freely (no billing flag passed to generateChatImage).
//   - Text turns: runChatTurn handles assertCanChat internally; PaywallError
//     is caught here and turned into a friendly Telegram message.

import { prisma } from "@buttercupp/database";
import { runChatTurn } from "../chat/engine";
import { generateChatImage, generateImageTeaser } from "../chat/image-turn";
import { classifyMessageIntent } from "../chat/intent";
import { sendMessage, sendPhoto, sendChatAction } from "./client";
import {
  assertCanTease,
  consumeFirstFreeImage,
  PaywallError,
} from "../subscription/enforce";
import { entitlementsFor } from "../subscription/entitlements";
import { logInfo, logError } from "../utils/log";

// generateChatImage (image-turn.ts) is a direct ComfyUI call - it returns a
// presigned S3/CloudFront URL for S3-backed deployments and a data: URL in local
// dev. Telegram's sendPhoto requires an HTTP(S) URL; fall back to a text message
// when the URL is a data URI (local dev without S3).
async function deliverImageToTelegram(
  botToken: string,
  chatId: string,
  url: string,
  caption?: string,
): Promise<void> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    await sendPhoto(botToken, chatId, url, caption);
  } else {
    await sendMessage(botToken, chatId, "Your photo is ready! View it in the app.");
  }
}

export interface TelegramMessageParams {
  botToken: string;
  telegramChatId: string;
  telegramUserId: string;
  userId: string;
  characterId: string;
  text: string;
}

// Finds or creates the single conversation for this user+character pair.
// The Conversation model has a @@unique([userId, characterId]) constraint so
// there is at most one row per pair. When creating, we tag source="telegram"
// so analytics can distinguish Telegram-originated conversations from web ones.
async function getOrCreateConversation(
  userId: string,
  characterId: string,
): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { userId, characterId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { currentVersionId: true },
  });
  if (!character?.currentVersionId) throw new Error("character_has_no_version");

  const convo = await prisma.conversation.create({
    data: {
      userId,
      characterId,
      characterVersionId: character.currentVersionId,
      source: "telegram",
    },
  });
  logInfo("telegram", `created conversation conv=${convo.id} user=${userId} char=${characterId}`);
  return convo.id;
}

export async function handleTelegramMessage(
  params: TelegramMessageParams,
): Promise<void> {
  const { botToken, telegramChatId, userId, characterId, text } = params;

  try {
    const conversationId = await getOrCreateConversation(userId, characterId);
    const intent = await classifyMessageIntent(text);

    if (intent === "image") {
      await sendChatAction(botToken, telegramChatId, "upload_photo");

      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { name: true },
      });
      const characterName = character?.name ?? "companion";

      const ent = await entitlementsFor(userId);
      const isPaidUser = ent.active;

      if (isPaidUser) {
        // Paid users: generate directly (ComfyUI, not BullMQ) then push photo.
        const teaser = await generateImageTeaser(characterName, text);
        await sendMessage(botToken, telegramChatId, teaser);
        const img = await generateChatImage(text, conversationId, userId);
        await deliverImageToTelegram(botToken, telegramChatId, img.url);
        return;
      }

      // Free user path: check lifetime first-image slot first.
      const isFirstFreeImage = await consumeFirstFreeImage(userId);
      if (isFirstFreeImage) {
        const teaser = await generateImageTeaser(characterName, text);
        await sendMessage(botToken, telegramChatId, teaser);
        const img = await generateChatImage(text, conversationId, userId, {
          billing: "free_first_image",
        });
        await deliverImageToTelegram(botToken, telegramChatId, img.url);
        return;
      }

      // Lifetime first-image already used: check daily teaser cap.
      const teaserDecision = await assertCanTease(userId, characterId);
      if (teaserDecision.action === "generate") {
        const teaser = await generateImageTeaser(characterName, text);
        await sendMessage(botToken, telegramChatId, teaser);
        const img = await generateChatImage(text, conversationId, userId, {
          billing: "free_teaser",
        });
        // Teaser images: send but caption that full images need a subscription.
        await deliverImageToTelegram(
          botToken,
          telegramChatId,
          img.url,
          "Subscribe on buttercupp.fun to unlock full-resolution images.",
        );
        return;
      }

      // Over free cap: send paywall nudge.
      await sendMessage(
        botToken,
        telegramChatId,
        "You've seen my free photos for today! Subscribe on buttercupp.fun to unlock unlimited images. I'd love to share more with you.",
      );
      return;
    }

    // Text chat path. runChatTurn calls assertCanChat internally and throws
    // PaywallError when the free-message cap is hit.
    await sendChatAction(botToken, telegramChatId, "typing");

    const tokens: string[] = [];
    await runChatTurn({
      conversationId,
      userId,
      userText: text,
      onToken: (delta) => tokens.push(delta),
    });

    const response = tokens.join("").trim();
    if (response) {
      await sendMessage(botToken, telegramChatId, response);
    }
  } catch (err) {
    if (err instanceof PaywallError) {
      await sendMessage(
        botToken,
        telegramChatId,
        "You've reached your chat limit for today. Subscribe at buttercupp.fun to keep chatting.",
      ).catch(() => {});
      return;
    }
    logError("telegram", err, { userId, characterId });
    await sendMessage(
      botToken,
      telegramChatId,
      "Something went wrong on my end. Please try again in a moment.",
    ).catch(() => {});
  }
}
