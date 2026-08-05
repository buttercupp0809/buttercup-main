// Poppy auth. Ported from ../Pellow/frontend/lib/auth.ts with the pieces
// Poppy needs today (auth + reset + magic-link scopes; no onboarding/billing
// scopes; no Amplify server-env fallback yet). Every scope uses a distinct
// JWT audience; a token minted for one scope MUST fail verification for the
// others. See CLAUDE.md for the singleton rule (this file imports `prisma`).
//
// Cookie is httpOnly, Secure in prod, SameSite=Lax (Poppy uses OAuth
// redirects, so Strict would break the round-trip). isProd gates Secure so
// local http:// dev works.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "@poppy/database";
import type { User } from "@poppy/database";
import {
  AUTH_COOKIE,
  TOKEN_MAX_AGE,
  RESET_MAX_AGE,
  JWT_ISSUER,
  JWT_AUD_AUTH,
  JWT_AUD_RESET,
  JWT_AUD_MAGIC,
} from "@/lib/constants";

// SECURITY (F10): reject weak signing keys. A short HS256 secret is
// brute-forceable. Accept >=32 chars, or a base64-decoded value >=32 bytes.
// This function is the ONLY entry point for the secret; every sign/verify
// helper below flows through it. Middleware duplicates this guard because it
// cannot import server-only code.
export function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET missing from process.env");
  }
  const rawLen = secret.length;
  let byteLen = rawLen;
  try {
    byteLen = Buffer.from(secret, "base64").length;
  } catch {
    byteLen = rawLen;
  }
  if (rawLen < 32 && byteLen < 32) {
    throw new Error(
      "JWT_SECRET too short: need >=32 characters or 32 bytes of entropy",
    );
  }
  return new TextEncoder().encode(secret);
}

const isProd = () => process.env.NODE_ENV === "production";

// ============================================================================
// Auth scope
// ============================================================================

export async function signAuthToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUD_AUTH)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyAuthToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUD_AUTH,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Reset scope (password reset flow lands in a later phase)
// ============================================================================

export async function signResetToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: "password-reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUD_RESET)
    .setIssuedAt()
    .setExpirationTime(`${RESET_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyResetToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUD_RESET,
    });
    if ((payload as JWTPayload & { purpose?: string }).purpose !== "password-reset") return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Magic-link scope (audience only; the raw link uses a random token, not a
// JWT. This scope exists so a magic-link-issued session could be down-scoped
// if we ever need it. Today magic-link consumption issues a full auth token.)
// ============================================================================

export async function signMagicScopeToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: "magic-link" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUD_MAGIC)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

// ============================================================================
// Cookie helpers
// ============================================================================

type CookieSetter = { set: (name: string, value: string, opts: Record<string, unknown>) => void };
type CookieAwareResponse = { cookies: CookieSetter };

export function setAuthCookie(res: CookieAwareResponse, token: string) {
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_MAX_AGE,
  });
}

export function clearAuthCookie(res: CookieAwareResponse) {
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ============================================================================
// Identity helpers (server components + route handlers)
// ============================================================================

export async function getAuthUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyAuthToken(token);
}

export async function getCurrentUser(): Promise<User | null> {
  const id = await getAuthUserId();
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

// Redirects to /login when the user is not authenticated. Used inside server
// components and layouts of the (protected) route group.
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Redirects to /age-gate when the user has not passed the age & compliance
// gate. Must be called AFTER requireAuth in the layout chain.
export async function requireAgeVerified(): Promise<User> {
  const user = await requireAuth();
  const passed =
    user.ageVerifiedAt !== null &&
    user.ageVerificationLevel !== "none" &&
    user.tosAcceptedAt !== null &&
    user.privacyAcceptedAt !== null;
  if (!passed) redirect("/age-gate");
  return user;
}

// API route guard: 401 if no cookie, 403 if the cookie user does not match
// the resource owner. Callers that do not own a resource can pass their own
// userId to assert authenticated-only access.
export async function requireAuthApi(
  requestedUserId: string,
): Promise<
  { authorized: true; userId: string } | { authorized: false; status: number; error: string }
> {
  const authUserId = await getAuthUserId();
  if (!authUserId) return { authorized: false, status: 401, error: "unauthenticated" };
  if (authUserId !== requestedUserId)
    return { authorized: false, status: 403, error: "forbidden" };
  return { authorized: true, userId: authUserId };
}
