import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildUserExport } from "@/lib/account";

export const runtime = "nodejs";

// GDPR/CCPA data export. Returns a JSON attachment. Rate-limited by the
// upstream middleware; the endpoint itself is auth-gated and only ever
// returns the caller's own bundle.
export async function POST() {
  const user = await requireAuth();
  const bundle = await buildUserExport(user.id);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="buttercupp-export-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
