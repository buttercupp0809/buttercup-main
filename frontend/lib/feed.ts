// Composed dashboard feed. Pulls a "continue chatting" recents rail plus a
// small set of curated feeds. Each section reuses listCharacters (via the
// same query builder) so the mature gating logic stays in one place.

import { prisma } from "@buttercupp/database";
import type { CharacterViewer } from "@buttercupp/database";
import type { CharacterCardDTO } from "@buttercupp/shared";
import { listCharacters } from "@/lib/characters";
import { pickPersonaImage } from "@/lib/persona-images";
import { signAssetUrl } from "@/lib/cdn";

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

function signMediaUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  // Local public paths (/personas/...) pass through; S3 keys get signed.
  if (url.startsWith("http") || url.startsWith("/")) return url;
  return signAssetUrl(url);
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
          media: {
            // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION
            // in schema.prisma.
            where: { kind: "image" as const, hidden: false },
            orderBy: [
              { isDisplay: "desc" as const },
              { isPrimary: "desc" as const },
              { sort: "asc" as const },
            ],
            take: 1,
          },
        },
      },
    },
  });
  return rows.map((c) => ({
    characterId: c.characterId,
    characterName: c.character.name,
    avatarUrl:
      signMediaUrl(c.character.media[0]?.url) ??
      avatarUrlFrom(c.character.currentVersion?.appearanceSheet?.referenceImageKeys) ??
      pickPersonaImage(c.characterId),
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    messageCount: c.messageCount,
  }));
}
