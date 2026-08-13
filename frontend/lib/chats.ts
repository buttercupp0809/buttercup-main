// Conversation listing for the /chats index, the chat 3-column list, and the
// sidebar recents rail. Adds an optional relationship snapshot for badging plus
// a last-message preview for the chat list.

import { prisma } from "@buttercupp/database";
import { pickPersonaImage } from "@/lib/persona-images";
import { signAssetUrl } from "@/lib/cdn";

export interface ConversationRow {
  conversationId: string;
  characterId: string;
  characterName: string;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  relationship: { affectionLevel: number; mood: string | null } | null;
}

function avatarUrlFrom(refs: string[] | undefined): string | null {
  if (!refs || refs.length === 0) return null;
  const key = refs[0];
  const base = process.env.CLOUDFRONT_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : key;
}

function signMediaUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("/")) return url;
  return signAssetUrl(url);
}

export async function listConversations(userId: string, take = 50): Promise<ConversationRow[]> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: "desc" }],
    take,
    include: {
      character: {
        include: {
          currentVersion: { include: { appearanceSheet: true } },
          media: {
            where: { kind: "image" },
            orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
            take: 1,
          },
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
    },
  });
  if (rows.length === 0) return [];

  const characterIds = rows.map((r) => r.characterId);
  const relRows = await prisma.relationshipState.findMany({
    where: { userId, characterId: { in: characterIds } },
    select: { characterId: true, affectionLevel: true, mood: true },
  });
  const relByChar = new Map(relRows.map((r) => [r.characterId, r]));

  return rows.map((c) => {
    const rel = relByChar.get(c.characterId);
    return {
      conversationId: c.id,
      characterId: c.characterId,
      characterName: c.character.name,
      avatarUrl:
        signMediaUrl(c.character.media[0]?.url) ??
        avatarUrlFrom(c.character.currentVersion?.appearanceSheet?.referenceImageKeys) ??
        pickPersonaImage(c.characterId),
      lastMessage: c.messages[0]?.content ?? null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      messageCount: c.messageCount,
      relationship: rel ? { affectionLevel: rel.affectionLevel, mood: rel.mood } : null,
    };
  });
}
