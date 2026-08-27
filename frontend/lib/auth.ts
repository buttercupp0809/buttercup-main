// ButterCupp auth. Ported from ../Pellow/frontend/lib/auth.ts with the pieces
// ButterCupp needs today (auth + reset + magic-link scopes; no onboarding/billing
// scopes; no Amplify server-env fallback yet). Every scope uses a distinct
// JWT audience; a token minted for one scope MUST fail verification for the
// others. See CLAUDE.md for the singleton rule (this file imports `prisma`).
//
// Cookie is httpOnly, Secure in prod, SameSite=Lax (ButterCupp uses OAuth
// redirects, so Strict would break the round-trip). isProd gates Secure so
// local http:// dev works.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "@buttercupp/database";
import type { User } from "@buttercupp/database";
import {
  AUTH_COOKIE,
  TOKEN_MAX_AGE,
  RESET_MAX_AGE,
  JWT_ISSUER,
  JWT_AUD_AUTH,
  JWT_AUD_RESET,
  JWT_AUD_MAGIC,
} from "@/lib/constants";
import { classifyDevice, truncateUserAgent } from "@/lib/device";

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

// Cross-subdomain cookie scope. In production the app is served from
// www.buttercupp.fun while the WS gateway and REST backend live at
// api.buttercupp.fun. A host-only cookie (no Domain) is only ever sent back
// to www, so the WebSocket handshake to api arrives with no auth cookie, the
// gateway rejects it (401), and chat silently drops to a non-streaming
// fallback that never delivers the reply live (the message only appears on
// reload). Setting Domain=.buttercupp.fun makes the browser send the auth
// cookie to every *.buttercupp.fun host, so the WS authenticates and streams.
// Leave AUTH_COOKIE_DOMAIN unset in local dev (localhost is single-host) so
// nothing changes there.
function cookieDomain(): string | undefined {
  const d = process.env.AUTH_COOKIE_DOMAIN?.trim();
  return d ? d : undefined;
}

export function setAuthCookie(res: CookieAwareResponse, token: string) {
  const domain = cookieDomain();
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_MAX_AGE,
    ...(domain ? { domain } : {}),
  });
}

export function clearAuthCookie(res: CookieAwareResponse) {
  const domain = cookieDomain();
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(domain ? { domain } : {}),
  });
}

// ============================================================================
// Login-device tracking (see packages/database/prisma/schema.prisma:User)
// ============================================================================

// Best-effort snapshot of "what device did this user just sign in from?".
// Written by every auth surface that mints a fresh session cookie:
// password login, signup, Google OAuth, magic-link consume, reset-password.
// Errors are swallowed and only logged: a DB blip here MUST NOT block a
// user from signing in - the fresh JWT and cookie have already been minted
// by the caller by the time this runs. The write is not awaited by any
// caller that returns a redirect (fire-and-forget), so the login redirect
// stays snappy even under DB latency.
export async function recordLogin(
  userId: string,
  req: Pick<Request, "headers">,
): Promise<void> {
  try {
    const ua = req.headers.get("user-agent");
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginDeviceType: classifyDevice(ua),
        lastLoginUserAgent: truncateUserAgent(ua),
      },
    });
  } catch (err) {
    console.warn("[auth.recordLogin] failed:", err);
  }
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

// Phase 34 Feature C: hard-block unverified password signups. Google OAuth
// users are exempt because Google already asserts email_verified at the token
// verification step (see api/auth/oauth/google/route.ts) and the OAuth route
// stamps emailVerifiedAt on both create and link paths. Detected here via
// oauthProvider === "google" || googleId != null so a Google user with a
// missing emailVerifiedAt (e.g. an older row not yet backfilled) is never
// bounced to /verify-email (they have no password to log back in with).
// Must be called AFTER requireAuth in the layout chain.
export async function requireEmailVerified(): Promise<User> {
  const user = await requireAuth();
  const isGoogleUser = user.oauthProvider === "google" || user.googleId !== null;
  if (!user.emailVerifiedAt && !isGoogleUser) {
    redirect("/verify-email");
  }
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
