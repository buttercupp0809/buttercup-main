// Pure types + client-safe helpers for the Your Companions surface. Split
// out of frontend/lib/companions.ts (which imports Prisma) so the client
// card can `import type { CompanionCardVM }` and `import { deriveBadge }`
// without dragging the DB client into the browser bundle.
import type { ContentRating, Visibility, ModerationStatus } from "@buttercupp/database";

export interface CompanionGenSummary {
  queued: number;
  processing: number;
  ready: number;
  failed: number;
  primaryReady: boolean;
}

export interface CompanionCardVM {
  id: string;
  name: string;
  avatarUrl: string | null;
  contentRating: ContentRating;
  visibility: Visibility;
  moderationStatus: ModerationStatus;
  createdAt: string;
  gen: CompanionGenSummary;
}

export type CompanionBadge =
  | { kind: "failed"; label: string }
  | { kind: "generating"; label: string }
  | { kind: "ready" }
  | { kind: "empty"; label: string };

// Pure helper: derive the badge state for a card. Same rule is exercised
// by unit tests and the client component so the two never drift.
export function deriveBadge(gen: CompanionGenSummary): CompanionBadge {
  if (gen.failed > 0) return { kind: "failed", label: "Some images failed" };
  if (gen.queued + gen.processing > 0) return { kind: "generating", label: "Generating..." };
  if (gen.primaryReady) return { kind: "ready" };
  return { kind: "empty", label: "No images yet" };
}

// Reduce a set of MediaAsset groupBy rows into a per-character summary.
// Pure; exported for unit testing.
export function summarizeAssetGroups(
  characterId: string,
  groups: Array<{ characterId: string | null; status: string; _count: number }>,
  primaryReady: boolean,
): CompanionGenSummary {
  const summary: CompanionGenSummary = {
    queued: 0,
    processing: 0,
    ready: 0,
    failed: 0,
    primaryReady,
  };
  for (const g of groups) {
    if (g.characterId !== characterId) continue;
    if (g.status === "queued") summary.queued += g._count;
    else if (g.status === "processing") summary.processing += g._count;
    else if (g.status === "ready") summary.ready += g._count;
    else if (g.status === "failed") summary.failed += g._count;
  }
  return summary;
}
