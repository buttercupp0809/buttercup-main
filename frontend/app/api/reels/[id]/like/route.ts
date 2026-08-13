import { prisma } from "@buttercupp/database";
import { getCurrentUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/api-helpers";
import { reelById } from "@/lib/reels/manifest";

export const runtime = "nodejs";

// Resolve a reel's seeded base like count. A DB-backed reel id is a
// CharacterMedia row; a fallback reel id ("1".."8") is a manifest entry.
async function baseLikesFor(reelId: string): Promise<number | null> {
  try {
    const media = await prisma.characterMedia.findUnique({
      where: { id: reelId },
      select: { kind: true, likesBase: true },
    });
    if (media && media.kind === "video") return media.likesBase;
  } catch {
    // fall through to manifest
  }
  return reelById(reelId)?.baseLikes ?? null;
}

// Toggle the current user's like on a reel. Idempotent per (user, reel) via the
// unique index, so count = baseLikes + COUNT(rows) cannot be double-counted.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const base = await baseLikesFor(id);
  if (base === null) return jsonError(404, "reel_not_found");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated");

  const existing = await prisma.reelLike.findUnique({
    where: { userId_reelId: { userId: user.id, reelId: id } },
  });

  let liked: boolean;
  if (existing) {
    await prisma.reelLike.delete({ where: { id: existing.id } });
    liked = false;
  } else {
    await prisma.reelLike.create({ data: { userId: user.id, reelId: id } });
    liked = true;
  }

  const dbCount = await prisma.reelLike.count({ where: { reelId: id } });
  return jsonOk({ liked, count: base + dbCount });
}
