import type { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function POST() {
  const res = jsonOk();
  clearAuthCookie(res as unknown as { cookies: NextResponse["cookies"] });
  return res;
}
