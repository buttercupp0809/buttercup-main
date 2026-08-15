import type { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api-helpers";

export const runtime = "nodejs";

// Dedicated decline route (not a reuse of /api/auth/logout): a consent
// refusal is distinct from a normal sign-out, and keeping it separate lets
// refusals be tracked/audited later without conflating them with logout.
// The cookie-clearing mechanics are identical to logout.
export async function POST() {
  const res = jsonOk({ redirect: "/login" });
  clearAuthCookie(res as unknown as { cookies: NextResponse["cookies"] });
  return res;
}
