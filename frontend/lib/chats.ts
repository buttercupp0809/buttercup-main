// Conversation listing for the /chats index and the sidebar recents rail.
// Wraps the same shape loadRecents() in feed.ts uses so the two surfaces stay
// consistent; adds an optional relationship snapshot for badging.

import { prisma } from "@buttercupp/database";

export interface ConversationRow {
  characterId: string;
  characterName: string;
  avatarUrl: string | null;
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

export async function listConversations(userId: string, take = 50): Promise<ConversationRow[]> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: "desc" }],
    take,
    include: {
      character: {
        include: {
          currentVersion: { include: { appearanceSheet: true } },
        },
      },
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
      characterId: c.characterId,
      characterName: c.character.name,
      avatarUrl: avatarUrlFrom(c.character.currentVersion?.appearanceSheet?.referenceImageKeys),
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      messageCount: c.messageCount,
      relationship: rel ? { affectionLevel: rel.affectionLevel, mood: rel.mood } : null,
    };
  });
}
