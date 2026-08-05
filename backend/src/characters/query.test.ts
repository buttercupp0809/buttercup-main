import { describe, expect, it } from "vitest";
import {
  buildCharacterWhere,
  buildCharacterOrderBy,
  VISITOR,
  viewerAllowsMature,
  type CharacterViewer,
} from "./query";
import { characterListQuerySchema } from "@buttercupp/shared";

const VERIFIED_MEMBER: CharacterViewer = { id: "user-1", ageVerified: true };
const UNVERIFIED_MEMBER: CharacterViewer = { id: "user-2", ageVerified: false };

function parse(q: Record<string, unknown>) {
  return characterListQuerySchema.parse(q);
}

describe("buildCharacterWhere", () => {
  it("always pins visibility=public + moderationStatus=approved", () => {
    const where = buildCharacterWhere(parse({}), VISITOR);
    expect(where.visibility).toBe("public");
    expect(where.moderationStatus).toBe("approved");
  });

  it("visitor is locked to contentRating=sfw even if they request mature", () => {
    const where = buildCharacterWhere(parse({ contentRating: "mature" }), VISITOR);
    expect(where.contentRating).toBe("sfw");
  });

  it("unverified member is locked to sfw", () => {
    const where = buildCharacterWhere(parse({ contentRating: "mature" }), UNVERIFIED_MEMBER);
    expect(where.contentRating).toBe("sfw");
  });

  it("verified member requesting mature gets mature", () => {
    const where = buildCharacterWhere(parse({ contentRating: "mature" }), VERIFIED_MEMBER);
    expect(where.contentRating).toBe("mature");
  });

  it("verified member with no rating filter gets both (no filter set)", () => {
    const where = buildCharacterWhere(parse({}), VERIFIED_MEMBER);
    expect(where.contentRating).toBeUndefined();
  });

  it("maps wire style '3d' to Prisma enum threeD", () => {
    const where = buildCharacterWhere(parse({ style: "3d" }), VERIFIED_MEMBER);
    expect(where.style).toBe("threeD");
  });

  it("tags become hasSome; single tag also works", () => {
    const where = buildCharacterWhere(parse({ tags: "warm,witty" }), VERIFIED_MEMBER);
    expect(where.tags).toEqual({ hasSome: ["warm", "witty"] });
  });

  it("q builds an OR over name/bio/tags with case-insensitive contains", () => {
    const where = buildCharacterWhere(parse({ q: "aria" }), VERIFIED_MEMBER);
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(3);
  });
});

describe("buildCharacterOrderBy", () => {
  it("popular sorts by popularityScore desc", () => {
    const ob = buildCharacterOrderBy("popular");
    expect(ob[0]).toEqual({ popularityScore: "desc" });
  });
  it("new sorts by createdAt desc", () => {
    const ob = buildCharacterOrderBy("new");
    expect(ob[0]).toEqual({ createdAt: "desc" });
  });
  it("trending sorts by popularityScore desc, then createdAt desc", () => {
    const ob = buildCharacterOrderBy("trending");
    expect(ob[0]).toEqual({ popularityScore: "desc" });
    expect(ob[1]).toEqual({ createdAt: "desc" });
  });
});

describe("viewerAllowsMature", () => {
  it("visitor: no", () => {
    expect(viewerAllowsMature(VISITOR)).toBe(false);
  });
  it("unverified member: no", () => {
    expect(viewerAllowsMature(UNVERIFIED_MEMBER)).toBe(false);
  });
  it("verified member: yes", () => {
    expect(viewerAllowsMature(VERIFIED_MEMBER)).toBe(true);
  });
});
