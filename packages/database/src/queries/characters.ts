// Pure query-builder for the character gallery. Lives in @buttercupp/database (not
// backend/) because frontend/app/api/characters/route.ts is the primary
// caller and cannot import from the backend workspace at compile time.
// backend/src/characters/query.ts re-exports these so the Phase 03 plan's
// file paths still work.

import type { Prisma } from "../types";
import {
  styleWireToEnum,
  type CharacterListQuery,
  type CharacterSort,
} from "@buttercupp/shared";

export interface CharacterViewer {
  id: string | null;
  ageVerified: boolean;
}

export const VISITOR: CharacterViewer = { id: null, ageVerified: false };

export function viewerAllowsMature(viewer: CharacterViewer): boolean {
  return viewer.id !== null && viewer.ageVerified;
}

export function buildCharacterWhere(
  input: CharacterListQuery,
  viewer: CharacterViewer,
): Prisma.CharacterWhereInput {
  const where: Prisma.CharacterWhereInput = {
    visibility: "public",
    moderationStatus: "approved",
  };

  if (input.style) where.style = styleWireToEnum(input.style);
  if (input.tags && input.tags.length > 0) where.tags = { hasSome: input.tags };

  if (!viewerAllowsMature(viewer)) {
    where.contentRating = "sfw";
  } else if (input.contentRating) {
    where.contentRating = input.contentRating;
  }

  if (input.q) {
    const q = input.q;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { tags: { has: q } },
    ];
  }

  return where;
}

export type CharacterOrderBy = Prisma.CharacterOrderByWithRelationInput[];

export function buildCharacterOrderBy(sort: CharacterSort): CharacterOrderBy {
  switch (sort) {
    case "new":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "trending":
      // TODO Phase 12: materialized recency-weighted score.
      return [{ popularityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "popular":
    default:
      return [{ popularityScore: "desc" }, { id: "desc" }];
  }
}
