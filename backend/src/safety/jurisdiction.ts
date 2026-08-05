// Jurisdiction gating for mature content. The list is deliberately
// conservative; a real deployment should source the current list from
// legal + update on a schedule.

export const RESTRICTED_MATURE_REGIONS = new Set<string>([
  // US states with strong age-verification laws / content restrictions
  "US-TX",
  "US-UT",
  "US-VA",
  "US-MS",
  "US-AR",
  "US-LA",
  "US-MT",
  // Country codes with legal restrictions on mature content
  "CN",
  "SA",
  "AE",
  "IN",
  "IR",
  "TR",
  "KR",
]);

export function isMatureAllowed(jurisdiction: string | null | undefined): boolean {
  if (!jurisdiction) return true; // unknown region defaults to allowed; legal to tighten later
  const j = jurisdiction.toUpperCase().trim();
  if (RESTRICTED_MATURE_REGIONS.has(j)) return false;
  // Also check bare country prefix (e.g. "US-TX" already handled; bare "US" is fine)
  return true;
}

export class MatureContentBlockedError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "MatureContentBlockedError";
  }
}

interface AssertInput {
  user: {
    jurisdiction: string | null;
    ageVerificationLevel: string;
    ageVerifiedAt: Date | null;
  };
  contentRating: "sfw" | "mature";
}

export function assertMatureAccess(input: AssertInput): void {
  if (input.contentRating !== "mature") return;
  if (!isMatureAllowed(input.user.jurisdiction)) {
    throw new MatureContentBlockedError("jurisdiction_restricted");
  }
  const verified =
    input.user.ageVerificationLevel !== "none" && input.user.ageVerifiedAt !== null;
  if (!verified) throw new MatureContentBlockedError("age_verification_required");
}
