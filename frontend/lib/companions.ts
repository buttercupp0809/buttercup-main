// Server-only data lib for the "Your Companions" section. Reads
// characters the signed-in user OWNS (Character.ownerUserId = user.id) and,
// for each, a live status summary derived from MediaAsset lifecycle rows.
//
// Pure types + helpers (usable by the client card) live in
// frontend/lib/companions-shared.ts so importing them does not drag Prisma
// (and, transitively, `pg`) into the browser bundle.
//
// Security: ownerUserId is the boundary. The caller must always be the
// authenticated user's id (see requireAuth()); no client-supplied value is
// accepted. System personas (ownerUserId = null) are excluded by the where
// clause.
import { prisma } from "@buttercupp/database";
import { signAssetUrl } from "@/lib/cdn";
import {
  summarizeAssetGroups,
  type CompanionCardVM,
} from "@/lib/companions-shared";

export type {
  CompanionCardVM,
  CompanionGenSummary,
  CompanionBadge,
} from "@/lib/companions-shared";
export { deriveBadge, summarizeAssetGroups } from "@/lib/companions-shared";

// Resolve a signed / proxy URL from a stored CharacterMedia.url. Mirrors
// the branching in primaryImageFrom (frontend/lib/characters.ts): local
// public paths pass through, full https URLs pass through, bare S3 keys
// get signed.
function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  if (url.startsWith("http")) return url;
  return signAssetUrl(url);
}

type CompanionMediaRow = {
  url: string;
  isPrimary: boolean;
  isDisplay: boolean;
};

function pickPrimary(media: CompanionMediaRow[]): string | null {
  const chosen =
    media.find((m) => m.isDisplay) ??
    media.find((m) => m.isPrimary) ??
    media[0] ??
    null;
  return resolveMediaUrl(chosen?.url ?? null);
}

export async function listCompanions(userId: string): Promise<CompanionCardVM[]> {
  const characters = await prisma.character.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      media: {
        where: { kind: "image", hidden: false },
        orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }],
        select: { url: true, isPrimary: true, isDisplay: true },
      },
    },
  });

  if (characters.length === 0) return [];

  const ids = characters.map((c) => c.id);
  const groups = await prisma.mediaAsset.groupBy({
    by: ["characterId", "status"],
    where: { userId, characterId: { in: ids }, kind: "image" },
    _count: true,
  });

  const groupRows = groups.map((g) => ({
    characterId: g.characterId,
    status: String(g.status),
    _count: typeof g._count === "number" ? g._count : 0,
  }));

  return characters.map((c) => {
    const avatarUrl = pickPrimary(c.media);
    return {
      id: c.id,
      name: c.name,
      avatarUrl,
      contentRating: c.contentRating,
      visibility: c.visibility,
      moderationStatus: c.moderationStatus,
      createdAt: c.createdAt.toISOString(),
      gen: summarizeAssetGroups(c.id, groupRows, Boolean(avatarUrl)),
    };
  });
}
