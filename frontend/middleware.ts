// ButterCupp edge middleware.
//
// Two important limits shape this file:
//   1. It runs in the Next.js edge runtime and CANNOT import Node-only APIs
//      or reach Prisma. It re-implements the fail-closed JWT_SECRET guard
//      that lib/auth.ts also uses; keep the two in sync.
//   2. The AGE GATE check needs the User row (ageVerifiedAt, tosAcceptedAt,
//      ...), which lives in the DB. Middleware therefore ONLY enforces
//      authentication + basic API hygiene (content-type on POST/PUT/PATCH,
//      same-origin for cross-origin writes). The age gate is enforced
//      server-side by the (protected) layout via requireAgeVerified().
//      Consent-version enforcement (Phase 29, needsConsent() in
//      frontend/lib/consent.ts) also lives in the (protected) layout, not
//      here, for the same reason: it needs the User row.
//
// Matcher covers the protected paths (see PROTECTED_PATH_PREFIXES) and every
// /api route.

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_COOKIE = "buttercupp_auth";
const JWT_ISSUER = "buttercupp";
const JWT_AUD_AUTH = "buttercupp:auth";

const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/chat",
  "/create",
  "/settings",
];

const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
  "/api/media",
  "/api/debug",
  "/api/admin/seed-personas",
];

function getSecretEdge(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing (edge)");
  const rawLen = secret.length;
  let byteLen = rawLen;
  try {
    byteLen = atob(secret).length;
  } catch {
    byteLen = rawLen;
  }
  if (rawLen < 32 && byteLen < 32) {
    throw new Error("JWT_SECRET too short (edge)");
  }
  return new TextEncoder().encode(secret);
}

async function verifyAuthCookie(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretEdge(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUD_AUTH,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function contentTypeOk(req: NextRequest): boolean {
  const m = req.method.toUpperCase();
  if (m !== "POST" && m !== "PUT" && m !== "PATCH") return true;
  // A genuinely bodyless write (e.g. POST /api/consent/decline, POST
  // /api/auth/logout) has no Content-Length (or "0") and no Transfer-Encoding,
  // so there is nothing for a content-type sniff to protect against. Without
  // this carve-out, `fetch(url, { method: "POST" })` (no body, no headers,
  // exactly what the browser sends) gets rejected here before it ever reaches
  // the route handler, silently breaking the endpoint.
  const contentLength = req.headers.get("content-length");
  const hasNoBody = (contentLength === null || contentLength === "0") && !req.headers.get("transfer-encoding");
  if (hasNoBody) return true;
  const ct = req.headers.get("content-type") ?? "";
  // Accept JSON and multipart (media upload). Reject everything else on write.
  return ct.startsWith("application/json") || ct.startsWith("multipart/form-data");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api hygiene: reject writes with the wrong content-type.
  if (pathname.startsWith("/api/") && !contentTypeOk(req)) {
    return NextResponse.json({ error: "unsupported_content_type" }, { status: 415 });
  }

  // /api auth: public auth endpoints skip the cookie check; everything else
  // under /api requires a valid auth cookie and returns 401 (not a redirect).
  if (pathname.startsWith("/api/") && !isPublicApi(pathname)) {
    const uid = await verifyAuthCookie(req.cookies.get(AUTH_COOKIE)?.value);
    if (!uid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.next();
  }

  // Page routes under the protected prefixes: redirect unauthenticated
  // visitors to /login. Age-gate enforcement is in the (protected) layout.
  if (isProtectedPath(pathname)) {
    const uid = await verifyAuthCookie(req.cookies.get(AUTH_COOKIE)?.value);
    if (!uid) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/dashboard",
    "/chat/:path*",
    "/chat",
    "/create/:path*",
    "/create",
    "/settings/:path*",
    "/settings",
  ],
};
