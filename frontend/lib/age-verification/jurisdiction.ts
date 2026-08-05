// Jurisdiction policy. Today this returns false for every input: the
// baseline is self-declared world-wide. Per-region rules land here as they
// are legally required (e.g. US-LA, US-TX age-verify statutes; UK OSA;
// specific EU member-state rules). Callers pass the jurisdiction from
// User.jurisdiction and the content rating being accessed.

import type { ContentRating } from "@buttercupp/database";

export interface JurisdictionInput {
  jurisdiction: string | null;
  contentRating: ContentRating;
}

// Returns true when the jurisdiction requires vendor-attested age verification
// for the given content rating. Today: always false. Extend as legal counsel
// signs off on per-region rules.
export function requiresVendorVerification(_input: JurisdictionInput): boolean {
  // TODO Phase 12: add per-region rules here.
  //  - Example: if (jurisdiction === "US-LA" && contentRating === "mature") return true;
  //  - Example: if (jurisdiction === "GB" && contentRating === "mature") return true;
  return false;
}
