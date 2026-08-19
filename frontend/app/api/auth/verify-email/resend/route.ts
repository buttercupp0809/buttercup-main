// Phase 34 Feature C: resend endpoint for the verification email. Requires
// the caller to be signed in (the (protected) layout is what routes them here
// in the first place) and only ever emails the address on the current User
// row, so an attacker cannot use it to spam a third party.
//
// Rate limit: no shared rate-limit helper exists in the frontend yet, so we
// use the MagicLink table itself as the rate window. If the user's most
// recent email-verify link was created less than RESEND_MIN_INTERVAL_S ago,
// we return 429 without issuing a new one. This is per-user and survives
// process restarts (unlike an in-memory Map), which is what "rate-limited
// using the existing pattern" boils down to here.

import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { getCurrentUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { issueEmailVerification, EMAIL_VERIFY_PURPOSE } from "@/lib/email-verify";
import { buildVerifyEmail } from "@/lib/emails/verify-email";

export const runtime = "nodejs";

const RESEND_MIN_INTERVAL_S = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated");
  if (user.emailVerifiedAt) return jsonOk({ alreadyVerified: true });

  const recent = await prisma.magicLink.findFirst({
    where: { userId: user.id, purpose: EMAIL_VERIFY_PURPOSE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent) {
    const ageMs = Date.now() - recent.createdAt.getTime();
    if (ageMs < RESEND_MIN_INTERVAL_S * 1000) {
      const retryAfter = Math.max(1, Math.ceil((RESEND_MIN_INTERVAL_S * 1000 - ageMs) / 1000));
      return NextResponse.json(
        { error: "rate_limited", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  const { rawToken } = await issueEmailVerification(user.id, user.email);
  const origin = new URL(req.url).origin;
  const link = `${origin}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  const { subject, html, text } = buildVerifyEmail(link);
  await sendEmail({ to: user.email, subject, html, text }).catch(() => null);

  return jsonOk({ sent: true });
}
