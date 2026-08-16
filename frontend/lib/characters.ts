// Character service (frontend). Wraps Prisma reads and shapes rows into the
// wire DTOs. Anything that produces a card also produces the joined
// avatar/greeting fields; the query builder handles filtering + ordering.

import { prisma, buildCharacterWhere, buildCharacterOrderBy, type CharacterViewer } from "@buttercupp/database";
import type { Character, CharacterVersion, AppearanceSheet, Prisma } from "@buttercupp/database";
import {
  styleEnumToWire,
  createCharacterInputSchema,
  type CharacterCardDTO,
  type CharacterDetailDTO,
  type CharacterListQuery,
  type CharacterListResponse,
  type CreateCharacterInput,
} from "@buttercupp/shared";
import { assertSafeId } from "@/lib/safe-types";
import { signAssetUrl } from "@/lib/cdn";
import { dedupeByIdentity, excludeHeroIdentity } from "@/lib/character-media";

// Only return a URL when CloudFront is configured. A raw S3 key is not a
// displayable URL, so we return null when the CDN base is absent.
function avatarUrlFrom(refs: string[] | undefined): string | null {
  if (!refs || refs.length === 0) return null;
  const key = refs[0];
  const base = process.env.CLOUDFRONT_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}`;
}

export type CharacterWithCurrent = Character & {
  currentVersion:
    | (CharacterVersion & { appearanceSheet: AppearanceSheet | null })
    | null;
  media?: { url: string; kind: string; isPrimary: boolean; isDisplay: boolean }[];
};

// The free/public image is the DISPLAY image (isDisplay = true), not the
// isPrimary hero (which stays behind the upgrade nag). Falls back to the old
// "first image" behavior for pre-backfill / single-image rows where isDisplay
// may not yet be set.
export function primaryImageFrom(media: CharacterWithCurrent["media"]): string | null {
  const img =
    media?.find((m) => m.kind === "image" && m.isDisplay === true) ??
    media?.find((m) => m.kind === "image");
  if (!img) return null;
  // Local paths (starting with /) are Next.js public/ static files (the seed's
  // stock persona art, e.g. /personas/5.webp, same assets STATIC_PERSONAS in
  // lib/marketing.ts serves directly) and are perfectly displayable as-is;
  // they are not an S3 key so signAssetUrl must not touch them.
  if (img.url.startsWith("/")) return img.url;
  // Full https URLs (CloudFront) are served directly.
  if (img.url.startsWith("http")) return img.url;
  // Bare S3 keys: sign via CloudFront.
  return signAssetUrl(img.url);
}

export function toCard(row: CharacterWithCurrent): CharacterCardDTO {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    tags: row.tags,
    style: row.style,
    contentRating: row.contentRating,
    // Avatar resolution order: CharacterMedia primary image (the new canonical
    // store) -> legacy appearanceSheet.referenceImageKeys -> a deterministic
    // local stock image so a card always shows a picture.
    avatarUrl:
      primaryImageFrom(row.media) ??
      avatarUrlFrom(row.currentVersion?.appearanceSheet?.referenceImageKeys) ??
      null,
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
      media: {
        // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
        // schema.prisma. A hidden row (e.g. a retired external reference
        // image) must never be selected here.
        where: { kind: "image", hidden: false },
        orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }],
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
      currentVersion: { include: { appearanceSheet: true, voiceProfile: true } },
      media: {
        // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
        // schema.prisma.
        where: { kind: "image", hidden: false },
        orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }],
      },
    },
  });
  if (!row) return null;

  const isOwner = viewer.id !== null && row.ownerUserId === viewer.id;
  const gatedMature = row.contentRating === "mature" && !viewer.ageVerified;
  const publicOk = row.visibility === "public" && row.moderationStatus === "approved";
  if (!publicOk && !isOwner) return null;

  const card = toCard(row as CharacterWithCurrent);

  // Gallery images only for authenticated viewers. Local paths (starting with /)
  // are excluded; only S3-backed URLs (https or signed keys) are served. The
  // locked gallery is every image that is NOT the display image (the
  // hero/isPrimary asset and any other non-display rows), so the free/display
  // image never doubles up as a "locked" tile.
  //
  // Dedup notes: comparing full URL strings against `card.avatarUrl` misses
  // two real duplicate cases in the seeded local DB and staging:
  //   1. Signed CloudFront URLs vary every call (dateLessThan), so the same
  //      key produces different strings between the avatar sign and the
  //      gallery sign.
  //   2. The seed writes byte-identical PNGs to two different owner-prefixed
  //      keys (e.g. `character-media/<A>/juggernaut-1-p1-v1.png` and
  //      `character-media/<B>/juggernaut-1-p1-v1.png`) and assigns one to
  //      isDisplay and the other to isPrimary. They have different keys but
  //      the same file bytes, so a string-URL dedup fails and the hero
  //      leaks in as free gallery tile 0 (the reported bug).
  // `mediaIdentity` (via excludeHeroIdentity/dedupeByIdentity) normalizes to
  // the last path segment of the underlying key, which is stable across
  // both cases. See frontend/lib/character-media.ts.
  const rawGallery = viewer.id !== null
    ? ((row as CharacterWithCurrent).media ?? [])
        .filter((m) => m.kind === "image" && !m.isDisplay && !m.url.startsWith("/"))
        .map((m) => (m.url.startsWith("http") ? m.url : signAssetUrl(m.url)))
    : [];
  const galleryImages = dedupeByIdentity(
    excludeHeroIdentity(card.avatarUrl, rawGallery),
  );

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
    galleryImages,
    isOwner,
    editDraft: isOwner ? buildEditDraft(row) : undefined,
  };
  return detail;
}

// Phase 28: reconstructs the full CreateCharacterInput shape from a
// Character + its current version, so the edit wizard (frontend/app/
// (protected)/create/context.tsx) can seed a draft from GET
// /api/characters/:id exactly like a fresh create draft. Owner-only (the
// caller must gate on isOwner); best-effort, returns undefined rather than
// throwing if the current version is missing an appearance sheet (a
// pathological state that should never happen post-Phase-06, but a broken
// edit entry point is better than a 500).
function buildEditDraft(row: {
  style: Character["style"];
  name: string;
  age: number;
  gender: string;
  bio: string;
  tags: string[];
  visibility: Character["visibility"];
  contentRating: Character["contentRating"];
  currentVersion:
    | (CharacterVersion & {
        appearanceSheet: AppearanceSheet | null;
        voiceProfile: { provider: string; voiceId: string } | null;
      })
    | null;
}): CreateCharacterInput | undefined {
  const version = row.currentVersion;
  const appearance = version?.appearanceSheet;
  if (!version || !appearance) return undefined;

  const candidate = {
    style: styleEnumToWire(row.style),
    name: row.name,
    age: row.age,
    gender: row.gender,
    traits: (appearance.traits as CreateCharacterInput["traits"]) ?? {},
    stylePrompt: appearance.stylePrompt,
    negativePrompt: appearance.negativePrompt,
    referenceImageKeys: appearance.referenceImageKeys,
    backstory: version.backstory,
    traitTags: row.tags,
    behavioralInstructions: version.behavioralInstructions,
    greeting: version.greeting,
    voiceProfile: {
      provider: version.voiceProfile?.provider ?? "system",
      voiceId: version.voiceProfile?.voiceId ?? "default",
    },
    bio: row.bio,
    visibility: row.visibility,
    contentRating: row.contentRating,
  };
  const parsed = createCharacterInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

// Shared version-number source of truth (Build step 6). Returns 1 for a
// brand-new character (no prior versions), max(versionNo) + 1 otherwise.
// Callers pass the ACTIVE transaction client so the read and the
// CharacterVersion insert that follows commit atomically together; calling
// this outside a transaction (as the old PATCH route did) leaves a race
// window between the aggregate read and the insert.
export async function nextVersionNo(
  tx: Pick<Prisma.TransactionClient, "characterVersion">,
  characterId: string,
): Promise<number> {
  const agg = await tx.characterVersion.aggregate({
    where: { characterId },
    _max: { versionNo: true },
  });
  return (agg._max.versionNo ?? 0) + 1;
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
