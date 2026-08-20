// Canonical CharacterMedia display ordering. Centralized here (Plans/
// cursor-prompt/35-major-fixes-batch.md #B) so every read site imports the
// SAME ordering and cannot silently drift. Previously the ordering
// [isDisplay desc, isPrimary desc, sort asc] was copy-pasted across
// frontend/lib/characters.ts, frontend/lib/feed.ts, frontend/lib/chats.ts,
// frontend/app/(protected)/chat/[characterId]/page.tsx,
// frontend/app/(protected)/reels/page.tsx, and this package's own scripts,
// which is exactly how divergence happens.
//
// Precedence (top-down):
//   1. isMain: the weekly-curated lead image (see #9.1). When present, it
//      wins unconditionally. This is what stops the "lead image rotates"
//      symptom: chat-generated images can never out-rank the main.
//   2. isDisplay: the free/public asset shown on cards and gallery tiles
//      (the paywalled hero stays behind isPrimary).
//   3. isPrimary: the paywalled hero. Tie-break, so a character with no
//      isDisplay set still shows something predictable.
//   4. sort: numeric ordering set by importers. Lower sort wins.

import type { Prisma } from "@prisma/client";

// Typed as a readonly tuple so callers get autocomplete for the ordering
// keys without accidentally mutating the shared array in place.
export const CHARACTER_MEDIA_ORDER_BY = [
  { isMain: "desc" as const },
  { isDisplay: "desc" as const },
  { isPrimary: "desc" as const },
  { sort: "asc" as const },
] satisfies Prisma.CharacterMediaOrderByWithRelationInput[];

// Loose form for consumers that build their own Prisma query args and only
// need the shape, not the readonly const-ness. Prefer CHARACTER_MEDIA_ORDER_BY
// where the readonly form works.
export function characterMediaOrderBy(): Prisma.CharacterMediaOrderByWithRelationInput[] {
  return [
    { isMain: "desc" },
    { isDisplay: "desc" },
    { isPrimary: "desc" },
    { sort: "asc" },
  ];
}
