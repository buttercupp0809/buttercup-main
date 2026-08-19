import type { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { GoogleOAuthDto } from "@buttercupp/shared";
import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";
import { POLICY_VERSION } from "@/lib/consent";
import { jwtVerify, createRemoteJWKSet } from "jose";

export const runtime = "nodejs";

// Google users skip the /age-gate screen entirely: Google has already
// authenticated a real person, so we auto-accept ToS/Privacy and self-declare
// age on their behalf. This mirrors what api/age/verify writes, minus the DOB
// (nullable in the schema; none of the gates read it). The enum has no
// "self_attested" member, so we use "self_declared" (the SelfDeclaredProvider
// level) as the non-"none" value.
const GOOGLE_AGE_LEVEL = "self_declared" as const;

// Best-effort 2-letter country from an edge geo header (Cloudflare or Vercel),
// defaulting to "US". Anything that is not exactly two ASCII letters is
// treated as absent.
function inferJurisdiction(req: Request): string {
  const raw =
    req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? "";
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : "US";
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);

interface GooglePayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  iss?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<GooglePayload | null> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) return null;
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, { audience });
    if (!payload.iss || !GOOGLE_ISS.has(payload.iss)) return null;
    return payload as GooglePayload;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    // OAuth is a ButterCupp-supported flow but not fully wired in Phase 01.
    // Returning 501 (not 500) makes the "not configured yet" state
    // observable to the client without leaking config details.
    return jsonError(501, "google_oauth_not_configured");
  }

  const parsed = await parseJson(req, GoogleOAuthDto);
  if (!parsed.ok) return parsed.response;

  const gpayload = await verifyGoogleIdToken(parsed.data.idToken);
  if (!gpayload || !gpayload.email || !gpayload.email_verified) {
    return jsonError(401, "google_id_token_invalid");
  }
  const email = gpayload.email.toLowerCase();
  const googleId = gpayload.sub;

  const now = new Date();

  // Idempotent age/consent gate check. True once the user has fully cleared
  // the gate (same predicate needsConsent() uses, inverted); when true we do
  // NOT overwrite their existing timestamps/version and do NOT write another
  // AgeVerification audit row.
  function isCleared(u: {
    ageVerifiedAt: Date | null;
    ageVerificationLevel: string;
    tosAcceptedAt: Date | null;
    privacyAcceptedAt: Date | null;
    acceptedPolicyVersion: string | null;
  }): boolean {
    return (
      u.ageVerifiedAt !== null &&
      u.ageVerificationLevel !== "none" &&
      u.tosAcceptedAt !== null &&
      u.privacyAcceptedAt !== null &&
      u.acceptedPolicyVersion === POLICY_VERSION
    );
  }

  // Auto-accept the age/consent gate on behalf of a Google user so the
  // /age-gate screen is never shown. Mirrors what api/age/verify writes, minus
  // the DOB (nullable in the schema; none of the gates read it). See the
  // comment on GOOGLE_AGE_LEVEL for the enum choice.
  const consentData = {
    ageVerifiedAt: now,
    ageVerificationLevel: GOOGLE_AGE_LEVEL,
    tosAcceptedAt: now,
    privacyAcceptedAt: now,
    consentAcceptedAt: now,
    acceptedPolicyVersion: POLICY_VERSION,
    jurisdiction: inferJurisdiction(req),
  };

  async function writeAudit(userId: string): Promise<void> {
    await prisma.ageVerification.create({
      data: {
        userId,
        provider: "google_oauth",
        level: GOOGLE_AGE_LEVEL,
        status: "verified",
        verifiedAt: now,
      },
    });
  }

  let user = await prisma.user.findUnique({ where: { googleId } });
  if (user) {
    // Returning Google user. Clear them if they are not yet gated (e.g. an
    // older row created before this auto-accept, or a policy-version bump).
    if (!isCleared(user)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? now, ...consentData },
      });
      await writeAudit(user.id);
    }
  } else {
    // Link on existing email OR create fresh. Phase 34 Feature C: Google has
    // already asserted email_verified at the token verification step above, so
    // stamp emailVerifiedAt on both create and link paths. An existing password
    // user who links Google becomes verified without ever seeing the email
    // verification flow, and requireEmailVerified() also treats any Google user
    // as exempt as a belt-and-braces guard.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const cleared = isCleared(existing);
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId,
          oauthProvider: "google",
          emailVerifiedAt: existing.emailVerifiedAt ?? now,
          ...(cleared ? {} : consentData),
        },
      });
      if (!cleared) await writeAudit(user.id);
    } else {
      user = await prisma.user.create({
        data: {
          email,
          googleId,
          oauthProvider: "google",
          emailVerifiedAt: now,
          ...consentData,
        },
      });
      await writeAudit(user.id);
    }
  }

  const token = await signAuthToken(user.id);
  const res = jsonOk({
    // Google users are fully cleared above (fresh or freshly-linked) or were
    // already cleared, so the age gate is never needed.
    userId: user.id,
    needsAgeGate: false,
  });
  setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, token);
  return res;
}
