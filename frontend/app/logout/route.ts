// Canonical logout endpoint. Every logout trigger in the app (top-nav profile
// menu, settings "Log out", the verify-email "Sign out" link) hits this exact
// route so cookie-clear semantics never drift.
//
// Handles GET (plain <a href="/logout"> links, browser address bar) AND POST
// (form submits / programmatic requests) with identical behavior: clear the
// auth cookie on the response, then 303-redirect to /login. A server-side
// redirect (rather than a JSON response + client-side navigation) guarantees
// the browser drops the Set-Cookie before it fetches the next page, so no
// stale React/client state can survive.
//
// Not under /api/, so the edge middleware's write-hygiene checks do not fire
// here; the matcher explicitly excludes /logout.

import { NextResponse, type NextRequest } from "next/server";
import { clearAuthCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildLogoutRedirect(req: NextRequest): NextResponse {
  // req.url is the internal Lambda/container URL in Amplify WEB_COMPUTE and
  // similar serverless runtimes (e.g. http://localhost:3000/logout), NOT the
  // public-facing origin. Using it as the base would redirect users to
  // localhost in production. NEXT_PUBLIC_APP_URL is the canonical public
  // origin; fall back to req.url only in local dev where the var is unset.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.url;
  const url = new URL("/login", base);
  // 303 forces the follow-up to be a GET even when the trigger was a POST
  // (form submit), which is the correct semantic for "action completed, now
  // go read this page".
  const res = NextResponse.redirect(url, { status: 303 });
  clearAuthCookie(res);
  return res;
}

export async function GET(req: NextRequest) {
  return buildLogoutRedirect(req);
}

export async function POST(req: NextRequest) {
  return buildLogoutRedirect(req);
}
