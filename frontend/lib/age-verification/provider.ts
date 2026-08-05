// AgeVerificationProvider. Baseline is SelfDeclaredProvider (user submits
// dob + acceptances, we trust and record). Some jurisdictions and mature
// content combinations will require a vendor-attested verification; those
// call getAgeProvider("vendor") once wired. The factory reads
// AGE_VERIFICATION_PROVIDER env, defaulting to "self_declared".

import type { AgeVerificationLevel } from "@poppy/database";

export interface AgeVerificationInput {
  userId: string;
  dob: Date;
  jurisdiction: string;
  ip?: string | null;
  userAgent?: string | null;
  // vendor-only extras (opaque to the interface)
  vendorPayload?: Record<string, unknown>;
}

export interface AgeVerificationResult {
  level: AgeVerificationLevel;
  status: "verified" | "rejected" | "pending";
  provider: string;
  evidenceRef?: string;
}

export interface AgeVerificationProvider {
  readonly name: string;
  verify(input: AgeVerificationInput): Promise<AgeVerificationResult>;
}

// Self-declared: user asserted their age; we recompute and accept.
// Age-<18 rejection MUST happen upstream (Zod DTO + server recompute); this
// provider always returns verified for the inputs it receives.
export const SelfDeclaredProvider: AgeVerificationProvider = {
  name: "self_declared",
  async verify(_input) {
    return {
      level: "self_declared",
      status: "verified",
      provider: "self_declared",
    };
  },
};

// Vendor: stub until we wire a real vendor (e.g. Yoti, Persona, Veriff).
// Throwing "not configured" is intentional; the escalation code path must
// notice and fall back gracefully or block, depending on jurisdiction policy.
export const VendorProvider: AgeVerificationProvider = {
  name: "vendor_verified",
  async verify(_input) {
    throw new Error(
      "AgeVerificationProvider: vendor is not configured. Set AGE_VERIFICATION_PROVIDER and vendor keys.",
    );
  },
};

export function getAgeProvider(override?: string): AgeVerificationProvider {
  const chosen = (override ?? process.env.AGE_VERIFICATION_PROVIDER ?? "self_declared").toLowerCase();
  switch (chosen) {
    case "vendor":
    case "vendor_verified":
      return VendorProvider;
    case "self_declared":
    default:
      return SelfDeclaredProvider;
  }
}
