import type { NextResponse } from "next/server";
import { prisma } from "@poppy/database";
import { GoogleOAuthDto } from "@poppy/shared";
import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";
import { jwtVerify, createRemoteJWKSet } from "jose";

export const runtime = "nodejs";

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
    // OAuth is a Poppy-supported flow but not fully wired in Phase 01.
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

  let user = await prisma.user.findUnique({ where: { googleId } });
  if (!user) {
    // Link on existing email OR create fresh. Do NOT set dob/jurisdiction; the
    // age gate captures those on the next hop.
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, oauthProvider: "google" },
      });
    } else {
      user = await prisma.user.create({
        data: { email, googleId, oauthProvider: "google" },
      });
    }
  }

  const token = await signAuthToken(user.id);
  const res = jsonOk({
    userId: user.id,
    needsAgeGate: !user.ageVerifiedAt || user.ageVerificationLevel === "none",
  });
  setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, token);
  return res;
}
