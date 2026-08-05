// Character service (frontend). Wraps Prisma reads and shapes rows into the
// wire DTOs. Anything that produces a card also produces the joined
// avatar/greeting fields; the query builder handles filtering + ordering.

import { prisma, buildCharacterWhere, buildCharacterOrderBy, type CharacterViewer } from "@poppy/database";
import type { Character, CharacterVersion, AppearanceSheet, Prisma } from "@poppy/database";
import {
  styleEnumToWire,
  type CharacterCardDTO,
  type CharacterDetailDTO,
  type CharacterListQuery,
  type CharacterListResponse,
} from "@poppy/shared";
import { assertSafeId } from "@/lib/safe-types";

// CloudFront URL is optional; when not set (local dev) we return the raw S3
// key. The gallery card handles a null avatarUrl gracefully.
function avatarUrlFrom(refs: string[] | undefined): string | null {
  if (!refs || refs.length === 0) return null;
  const key = refs[0];
  const base = process.env.CLOUDFRONT_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : key;
}

type CharacterWithCurrent = Character & {
  currentVersion:
    | (CharacterVersion & { appearanceSheet: AppearanceSheet | null })
    | null;
};

function toCard(row: CharacterWithCurrent): CharacterCardDTO {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    tags: row.tags,
    style: row.style,
    contentRating: row.contentRating,
    avatarUrl: avatarUrlFrom(row.currentVersion?.appearanceSheet?.referenceImageKeys),
    popularityScore: row.popularityScore,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCharacters(
  input: CharacterListQuery,
  viewer: CharacterViewer,
): Promise<CharacterListResponse> {
  const where = buildCharacterWhere(input, viewer);
  const orderBy = buildCharacterOrderBy(input.sort);

  // Keyset pagination: take limit+1 to detect a next page. We combine cursor
  // with orderBy; Prisma supports { cursor: { id } } which requires a
  // deterministic secondary sort key. All three sorts include `id` as the
  // final tiebreaker in buildCharacterOrderBy for this reason.
  const findArgs: Prisma.CharacterFindManyArgs = {
    where,
    orderBy,
    take: input.limit + 1,
    include: {
      currentVersion: {
        include: { appearanceSheet: true },
      },
    },
  };
  if (input.cursor) {
    findArgs.cursor = { id: input.cursor };
    findArgs.skip = 1;
  }

  const rows = (await prisma.character.findMany(findArgs)) as CharacterWithCurrent[];
  let nextCursor: string | null = null;
  if (rows.length > input.limit) {
    const overflow = rows.pop();
    nextCursor = overflow?.id ?? null;
  }

  return { items: rows.map(toCard), nextCursor };
}

export async function getCharacterDetail(
  rawId: string,
  viewer: CharacterViewer,
): Promise<CharacterDetailDTO | null> {
  const id = assertSafeId(rawId, "characterId");
  const row = await prisma.character.findUnique({
    where: { id },
    include: {
      currentVersion: { include: { appearanceSheet: true } },
    },
  });
  if (!row) return null;

  const isOwner = viewer.id !== null && row.ownerUserId === viewer.id;
  const gatedMature = row.contentRating === "mature" && !viewer.ageVerified;
  const publicOk = row.visibility === "public" && row.moderationStatus === "approved";
  if (!publicOk && !isOwner) return null;

  const card = toCard(row as CharacterWithCurrent);

  const detail: CharacterDetailDTO = {
    ...card,
    // Strip greeting + personality for the gated mature payload; the card
    // fields (name/bio/tags/blurred avatar) remain so the CTA can render.
    greeting: gatedMature ? "" : row.currentVersion?.greeting ?? "",
    personalitySummary: gatedMature ? "" : row.currentVersion?.personality ?? "",
    creatorLabel: row.ownerUserId === null ? "system" : "community",
    version: {
      id: row.currentVersion?.id ?? "",
      versionNo: row.currentVersion?.versionNo ?? 0,
      createdAt: (row.currentVersion?.createdAt ?? row.createdAt).toISOString(),
    },
    requiresAgeVerification: gatedMature || undefined,
  };
  // styleEnumToWire lives in @poppy/shared and is currently only used by the
  // client; kept in scope here so future consumers do not accidentally send
  // "threeD" over the wire.
  void styleEnumToWire;
  return detail;
}

// Pure reducer for the facet-tags aggregator. Extracted so the counting
// logic is unit-testable without a DB. Returns the top-N most-common tags
// across the input tag arrays.
export function topTagsFrom(tagLists: string[][], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const list of tagLists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const t = typeof raw === "string" ? raw.trim() : "";
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

// Facet tags for the discover toolbar. Cheap: pulls just the `tags` column
// off recent approved+public characters the viewer may see, dedupes, and
// returns the top N. Never throws; empty on failure so the toolbar omits
// the tag row.
export async function getFacetTags(viewer: CharacterViewer, limit = 12): Promise<string[]> {
  try {
    const rows = await prisma.character.findMany({
      where: {
        visibility: "public",
        moderationStatus: "approved",
        // Mature filter mirrors buildCharacterWhere without importing it,
        // because we only need a coarse SELECT here.
        ...(viewer.ageVerified ? {} : { contentRating: "sfw" as const }),
      },
      orderBy: [{ popularityScore: "desc" }],
      take: 200,
      select: { tags: true },
    });
    return topTagsFrom(
      rows.map((r) => r.tags),
      limit,
    );
  } catch {
    return [];
  }
}

// Fire-and-forget popularity bump. Increments popularityScore by a small
// constant on a background microtask; never throws, never blocks the caller.
// Real trending scoring lands in Phase 12; this is a floor signal so sort by
// popular has something to move.
export function bumpCharacterView(characterId: string): void {
  try {
    const id = assertSafeId(characterId, "characterId");
    void prisma.character
      .update({
        where: { id },
        data: { popularityScore: { increment: 0.1 } },
      })
      .catch(() => {
        // swallowed on purpose
      });
  } catch {
    // invalid id: also swallowed. View bumps must never break page load.
  }
}
