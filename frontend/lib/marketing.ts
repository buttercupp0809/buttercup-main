// Marketing landing data helper. Goes through the same read path the gallery
// uses (listCharacters + getViewer) so the hero shows REAL public characters
// with correct mature gating. Falls back to a static persona list when the DB
// is empty or unreachable so the landing page never shows skeleton tiles.

import { characterListQuerySchema, type CharacterCardDTO } from "@buttercupp/shared";
import { viewerAllowsMature } from "@buttercupp/database";
import { listCharacters } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";

// `taglineFrom` lives in `@/lib/text` so client components can use it
// without pulling `getViewer` -> `@/lib/auth` -> `next/headers` into their
// bundle (which Next rejects at build time).
export { taglineFrom } from "@/lib/text";

export interface LandingCharactersResult {
  items: CharacterCardDTO[];
  viewerAllowsMature: boolean;
}

// Minimal static persona cards shown when the DB has no approved public
// characters yet (fresh deploy / not seeded). Images are Next.js public
// static files (/personas/N.webp) so no S3 or CloudFront signing needed.
const STATIC_PERSONAS: CharacterCardDTO[] = [
  { id: "s1", name: "Aria", bio: "Your warm, playful neighbor who always has time for you.", tags: ["warm", "playful", "caring"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/1.webp", popularityScore: 9800, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s2", name: "Mia", bio: "Dreamy, bookish, and a little bit magic.", tags: ["dreamy", "gentle", "intellectual"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/2.webp", popularityScore: 9500, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s3", name: "Sofia", bio: "A painter who speaks in metaphors and sees the world in color.", tags: ["mysterious", "artistic", "romantic"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/3.webp", popularityScore: 9200, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s4", name: "Luna", bio: "Sharp, ambitious, and used to getting what she wants.", tags: ["confident", "dominant", "witty"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/4.webp", popularityScore: 8900, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s5", name: "Ivy", bio: "Your co-op partner in games and in trouble.", tags: ["playful", "bubbly", "geeky"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/5.webp", popularityScore: 8600, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s6", name: "Jade", bio: "A calm, gentle presence who makes you feel safe.", tags: ["caring", "gentle", "loyal"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/6.webp", popularityScore: 8300, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s7", name: "Zoe", bio: "Always halfway to the next adventure, and wants you along.", tags: ["adventurous", "bold", "curious"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/7.webp", popularityScore: 8000, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s8", name: "Sable", bio: "Sultry, confident, and unapologetically warm.", tags: ["sultry", "confident", "sensual"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/8.webp", popularityScore: 7700, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s9", name: "Cora", bio: "Your warm, playful neighbor who always has time for you.", tags: ["warm", "playful", "caring"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/9.webp", popularityScore: 7400, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s10", name: "Nova", bio: "Dreamy, bookish, and a little bit magic.", tags: ["dreamy", "gentle", "intellectual"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/10.webp", popularityScore: 7100, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s11", name: "Emma", bio: "Sharp, ambitious, and used to getting what she wants.", tags: ["confident", "dominant", "witty"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/11.webp", popularityScore: 6800, createdAt: "2025-01-01T00:00:00.000Z" },
  { id: "s12", name: "Kai", bio: "A painter who speaks in metaphors and sees the world in color.", tags: ["mysterious", "artistic", "romantic"], style: "realistic", contentRating: "sfw", avatarUrl: "/personas/12.webp", popularityScore: 6500, createdAt: "2025-01-01T00:00:00.000Z" },
];

export async function getLandingCharacters(): Promise<LandingCharactersResult> {
  try {
    const viewer = await getViewer();
    // The landing page leads with the roster itself, so it needs a full grid
    // worth of personas, not a three-card teaser.
    const query = characterListQuerySchema.parse({ sort: "popular", limit: 24 });
    const { items } = await listCharacters(query, viewer);
    if (items.length > 0) return { items, viewerAllowsMature: viewerAllowsMature(viewer) };
    return { items: STATIC_PERSONAS, viewerAllowsMature: false };
  } catch {
    return { items: STATIC_PERSONAS, viewerAllowsMature: false };
  }
}
