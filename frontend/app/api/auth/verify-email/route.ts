// Phase 34 Feature C: click-handler for the verification link emailed at
// signup. On success we stamp User.emailVerifiedAt (via
// consumeEmailVerification) and redirect into the app; on failure we bounce
// back to /verify-email with an error banner so the user can hit "resend".
// The endpoint is GET (not POST) because email clients only follow anchor
// hrefs; the token is single-use so replay is bounded.

import { NextResponse } from "next/server";
import { consumeEmailVerification } from "@/lib/email-verify";
import { publicUrl } from "@/lib/public-url";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeEmailVerification(token);
  // Redirect targets are built on the PUBLIC origin, not req.url: behind the
  // Amplify proxy req.url is the container-internal http://localhost:3000, so
  // basing the redirect on it sends the just-verified user to localhost. See
  // lib/public-url.ts.
  if (!result.ok) {
    const code = result.reason ?? "invalid";
    return NextResponse.redirect(publicUrl(req, `/verify-email?error=${code}`), 302);
  }
  // Post-consent onboarding wizard is the app default landing (the
  // (protected) layout will bounce a verified but un-onboarded user to
  // /onboarding anyway; see frontend/app/(protected)/layout.tsx).
  return NextResponse.redirect(publicUrl(req, "/dashboard"), 302);
}
