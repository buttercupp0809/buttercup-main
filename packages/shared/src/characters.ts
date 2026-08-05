// Character discovery DTOs + query schema. Consumed by the gallery UI
// (server + client components) and the /api/characters route.
//
// Style values on the wire are "realistic" | "3d" | "anime" because "3d" is
// the human-facing token. The Prisma enum spells it "threeD" (enum values
// cannot start with a digit); the mapping happens in the query builder, not
// here.

import { z } from "zod";
import type { CharacterStyle, ContentRating } from "./types";

export const characterSortSchema = z.enum(["popular", "new", "trending"]);
export type CharacterSort = z.infer<typeof characterSortSchema>;

export const characterStyleWireSchema = z.enum(["realistic", "3d", "anime"]);
export type CharacterStyleWire = z.infer<typeof characterStyleWireSchema>;

export const characterContentRatingSchema = z.enum(["sfw", "mature"]);

const csvString = z.union([
  z.string().transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean)),
  z.array(z.string()),
]);

// Safe search string: 1 to 100 chars, only characters that make sense in a
// name/bio/tag search. Rejects control chars and everything that could try to
// smuggle a Prisma operator through a JSON body.
const safeSearchString = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u, "invalid search string");

export const characterListQuerySchema = z.object({
  sort: characterSortSchema.default("popular"),
  style: characterStyleWireSchema.optional(),
  tags: csvString.optional(),
  contentRating: characterContentRatingSchema.optional(),
  q: safeSearchString.optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type CharacterListQuery = z.infer<typeof characterListQuerySchema>;

export interface CharacterCardDTO {
  id: string;
  name: string;
  bio: string;
  tags: string[];
  style: CharacterStyle;
  contentRating: ContentRating;
  avatarUrl: string | null;
  popularityScore: number;
  createdAt: string;
}

export interface CharacterDetailDTO extends CharacterCardDTO {
  greeting: string;
  personalitySummary: string;
  creatorLabel: "system" | "community";
  version: {
    id: string;
    versionNo: number;
    createdAt: string;
  };
  requiresAgeVerification?: boolean;
}

export interface CharacterListResponse {
  items: CharacterCardDTO[];
  nextCursor: string | null;
}

// Map the wire style token ("3d") to the Prisma enum name ("threeD").
export function styleWireToEnum(w: CharacterStyleWire): CharacterStyle {
  return w === "3d" ? "threeD" : w;
}

// Reverse mapping for API responses so the client never has to know about the
// Prisma enum name.
export function styleEnumToWire(e: CharacterStyle): CharacterStyleWire {
  return e === "threeD" ? "3d" : e;
}
