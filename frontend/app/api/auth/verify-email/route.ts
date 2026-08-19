// Phase 34 Feature C: click-handler for the verification link emailed at
// signup. On success we stamp User.emailVerifiedAt (via
// consumeEmailVerification) and redirect into the app; on failure we bounce
// back to /verify-email with an error banner so the user can hit "resend".
// The endpoint is GET (not POST) because email clients only follow anchor
// hrefs; the token is single-use so replay is bounded.

import { NextResponse } from "next/server";
import { consumeEmailVerification } from "@/lib/email-verify";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    const code = result.reason ?? "invalid";
    return NextResponse.redirect(new URL(`/verify-email?error=${code}`, url), 302);
  }
  // Post-consent onboarding wizard is the app default landing (the
  // (protected) layout will bounce a verified but un-onboarded user to
  // /onboarding anyway; see frontend/app/(protected)/layout.tsx).
  return NextResponse.redirect(new URL("/dashboard", url), 302);
}
