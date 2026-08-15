// Single source of truth for the current consent policy version. Bump this
// whenever Terms or Privacy Policy materially change; every user is
// re-prompted exactly once on their next protected navigation.
export const POLICY_VERSION = "2026-08-15";

// Pure predicate: true when the user has NOT accepted the current policy
// version (covers first login, where acceptedPolicyVersion is null, and a
// version bump, where it is stale). This is the single source of truth the
// (protected) layout uses to decide whether to render the consent gate; age,
// ToS, and privacy acceptance are kept in the same predicate so they act as
// one gate instead of four scattered checks.
export function needsConsent(u: {
  ageVerifiedAt: Date | null;
  ageVerificationLevel: string;
  tosAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  acceptedPolicyVersion: string | null;
}): boolean {
  const ageOk =
    u.ageVerifiedAt !== null &&
    u.ageVerificationLevel !== "none" &&
    u.tosAcceptedAt !== null &&
    u.privacyAcceptedAt !== null;
  return !ageOk || u.acceptedPolicyVersion !== POLICY_VERSION;
}
