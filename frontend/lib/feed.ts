// Composed dashboard feed. Pulls a "continue chatting" recents rail plus a
// small set of curated feeds. Each section reuses listCharacters (via the
// same query builder) so the mature gating logic stays in one place.

import { prisma } from "@buttercupp/database";
import type { CharacterViewer } from "@buttercupp/database";
import type { CharacterCardDTO } from "@buttercupp/shared";
import { listCharacters } from "@/lib/characters";

export interface RecentChat {
  characterId: string;
  characterName: string;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  messageCount: number;
}

export interface DashboardFeed {
  recents: RecentChat[];
  sections: { title: string; items: CharacterCardDTO[] }[];
}

function avatarUrlFrom(refs: string[] | undefined): string | null {
  if (!refs || refs.length === 0) return null;
  const key = refs[0];
  const base = process.env.CLOUDFRONT_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : key;
}

export async function getDashboardFeed(viewer: CharacterViewer): Promise<DashboardFeed> {
  const [recents, popular, fresh, trending] = await Promise.all([
    viewer.id ? loadRecents(viewer.id) : Promise.resolve<RecentChat[]>([]),
    listCharacters({ sort: "popular", limit: 8 } as never, viewer),
    listCharacters({ sort: "new", limit: 8 } as never, viewer),
    listCharacters({ sort: "trending", limit: 8 } as never, viewer),
  ]);

  // TODO(personalization): "For you" currently mirrors popular. Swap this
  // for a tag-affinity or embeddings-based query once we track per-user
  // preference signals.
  return {
    recents,
    sections: [
      { title: "For you", items: popular.items },
      { title: "New this week", items: fresh.items },
      { title: "Trending", items: trending.items },
      { title: "Popular", items: popular.items },
    ],
  };
}

async function loadRecents(userId: string): Promise<RecentChat[]> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: "desc" }],
    take: 6,
    include: {
      character: {
        include: {
          currentVersion: { include: { appearanceSheet: true } },
        },
      },
    },
  });
  return rows.map((c) => ({
    characterId: c.characterId,
    characterName: c.character.name,
    avatarUrl: avatarUrlFrom(c.character.currentVersion?.appearanceSheet?.referenceImageKeys),
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    messageCount: c.messageCount,
  }));
}
