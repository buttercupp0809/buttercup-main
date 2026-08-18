// Public reel data for the marketing landing carousel. No per-user like state
// (the landing is unauthenticated); just enough to render a preview + link.
// Falls back to the static REELS manifest when the DB has no video rows (e.g.
// fresh deploy, not yet seeded).

import { prisma } from "@buttercupp/database";
import { signAssetUrl } from "@/lib/cdn";
import { pickPersonaImage } from "@/lib/persona-images";
import { REELS } from "@/lib/reels/manifest";

export interface PublicReel {
  id: string;
  src: string;
  name: string;
  location: string;
  avatar: string; // signed URL or "" when unavailable
  characterId: string;
  /**
   * Displayed like total: `likesBase` plus actual ReelLike rows. Matches what
   * /reels already shows for the same media, so the two surfaces cannot
   * disagree.
   *
   * Be aware that `likesBase` is NOT real engagement: prisma/seed.ts assigns a
   * deterministic 1k..15k number per reel. Anything rendering this value is
   * showing seeded social proof.
   */
  likes: number;
}

export async function getPublicReels(limit = 12): Promise<PublicReel[]> {
  try {
    const vids = await prisma.characterMedia.findMany({
      // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
      // schema.prisma.
      where: { kind: "video", hidden: false },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
      include: {
        character: {
          include: {
            media: {
              where: { kind: "image", hidden: false },
              // isDisplay first: the free/public image must win over the
              // isPrimary hero, exactly like lib/feed.ts and lib/characters.ts.
              orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }],
              take: 1,
            },
          },
        },
      },
    });
    if (vids.length === 0) return manifestFallback(limit);
    // One grouped count for the whole page rather than a query per reel.
    const likeRows = await prisma.reelLike.groupBy({
      by: ["reelId"],
      where: { reelId: { in: vids.map((v) => v.id) } },
      _count: { reelId: true },
    });
    const likeCount = new Map(likeRows.map((r) => [r.reelId, r._count.reelId]));
    return vids.map((v) => ({
      id: v.id,
      src: signIfBareKey(v.url),
      name: v.character.name,
      location: v.character.location ?? "",
      likes: v.likesBase + (likeCount.get(v.id) ?? 0),
      avatar: (() => {
        const u = v.character.media[0]?.url ?? pickPersonaImage(v.characterId);
        if (!u) return "";
        if (u.startsWith("/") || u.startsWith("http")) return u;
        return signAssetUrl(u);
      })(),
      characterId: v.characterId,
    }));
  } catch {
    return manifestFallback(limit);
  }
}

function manifestFallback(limit: number): PublicReel[] {
  return REELS.slice(0, limit).map((r) => ({
    id: r.id,
    src: signIfBareKey(r.src),
    name: r.name,
    location: r.location,
    avatar: r.avatar,
    characterId: r.id,
    likes: r.baseLikes,
  }));
}

// Reel videos live in S3 as bare keys ("reels/<id>.mp4"). Absolute URLs
// pass through untouched. Legacy DB rows persisted as "/reels/<id>.mp4"
// (from before the S3 migration) are rewritten to the bare S3 key and
// signed, so seeded rows keep working after the local mp4s are removed.
function signIfBareKey(u: string): string {
  if (!u) return u;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/reels/")) return signAssetUrl(u.slice(1));
  if (u.startsWith("/")) return u;
  return signAssetUrl(u);
}
