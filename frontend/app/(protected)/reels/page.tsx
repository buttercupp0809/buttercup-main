import { prisma, CHARACTER_MEDIA_ORDER_BY } from "@buttercupp/database";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { REELS } from "@/lib/reels/manifest";
import { ReelScroller, type ReelItem } from "@/components/reels/ReelScroller";
import { signAssetUrl } from "@/lib/cdn";

export const dynamic = "force-dynamic";

// Reel videos in the manifest are bare S3 keys ("reels/<id>.mp4"). Absolute
// URLs pass through untouched. Legacy DB rows persisted as "/reels/<id>.mp4"
// (from before the S3 migration) are rewritten to the bare S3 key and
// signed, so seeded rows keep working after the local mp4s were removed.
function signIfBareKey(u: string): string {
  if (!u) return u;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/reels/")) return signAssetUrl(u.slice(1));
  if (u.startsWith("/")) return u;
  return signAssetUrl(u);
}

// Preferred path: reels come from CharacterMedia (kind=video), so each reel
// carries its persona (name, location, avatar, chat link) straight from the DB.
async function dbReels(userId: string | null): Promise<ReelItem[]> {
  const videos = await prisma.characterMedia.findMany({
    // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
    // schema.prisma.
    where: { kind: "video", hidden: false },
    orderBy: [{ characterId: "asc" }, { sort: "asc" }],
    include: {
      character: {
        include: {
          media: {
            where: { kind: "image" as const, hidden: false },
            orderBy: CHARACTER_MEDIA_ORDER_BY,
            take: 1,
          },
        },
      },
    },
  });
  if (videos.length === 0) return [];

  const ids = videos.map((v) => v.id);
  const { likedSet, countMap } = await likeState(userId, ids);

  return videos.map((v) => ({
    id: v.id,
    src: signIfBareKey(v.url),
    name: v.character.name,
    location: v.character.location ?? "",
    avatar: (() => {
      const u = v.character.media[0]?.url;
      if (!u) return null;
      if (u.startsWith("/") || u.startsWith("http")) return u; // public path or absolute URL
      return signAssetUrl(u); // bare S3 key: signAssetUrl proxies via /api/media when CDN not set
    })(),
    chatHref: `/chat/${v.characterId}`,
    likes: v.likesBase + (countMap.get(v.id) ?? 0),
    liked: likedSet.has(v.id),
  }));
}

// Fallback path: static manifest when the DB has no video media yet (e.g. not
// reseeded). Chat Now resolves persona name -> id, else lands on /discover.
async function manifestReels(userId: string | null): Promise<ReelItem[]> {
  const names = Array.from(new Set(REELS.map((r) => r.characterName)));
  const nameToId = new Map<string, string>();
  try {
    const chars = await prisma.character.findMany({
      where: { ownerUserId: null, name: { in: names } },
      select: { id: true, name: true },
    });
    for (const c of chars) nameToId.set(c.name, c.id);
  } catch {
    // Chat Now degrades to /discover
  }
  const { likedSet, countMap } = await likeState(
    userId,
    REELS.map((r) => r.id),
  );
  return REELS.map((r) => ({
    id: r.id,
    src: signIfBareKey(r.src),
    name: r.name,
    location: r.location,
    avatar: r.avatar || null,
    chatHref: nameToId.get(r.characterName) ? `/chat/${nameToId.get(r.characterName)}` : "/discover",
    likes: r.baseLikes + (countMap.get(r.id) ?? 0),
    liked: likedSet.has(r.id),
  }));
}

async function likeState(userId: string | null, reelIds: string[]) {
  const likedSet = new Set<string>();
  const countMap = new Map<string, number>();
  try {
    if (userId) {
      const mine = await prisma.reelLike.findMany({
        where: { userId, reelId: { in: reelIds } },
        select: { reelId: true },
      });
      for (const m of mine) likedSet.add(m.reelId);
    }
    const grouped = await prisma.reelLike.groupBy({
      by: ["reelId"],
      where: { reelId: { in: reelIds } },
      _count: { reelId: true },
    });
    for (const g of grouped) countMap.set(g.reelId, g._count.reelId);
  } catch {
    // ignore: counts fall back to base likes, liked stays false
  }
  return { likedSet, countMap };
}

export default async function ReelsPage() {
  await requireAuth();
  const user = await getCurrentUser().catch(() => null);

  let items: ReelItem[] = [];
  try {
    items = await dbReels(user?.id ?? null);
  } catch {
    items = [];
  }
  if (items.length === 0) items = await manifestReels(user?.id ?? null);

  return (
    <section className="h-full">
      <h1 className="sr-only">Reels</h1>
      <ReelScroller items={items} />
    </section>
  );
}
