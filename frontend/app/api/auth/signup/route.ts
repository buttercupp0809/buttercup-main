import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { SignupDto } from "@buttercupp/shared";
import { hashPassword } from "@/lib/password";
import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { issueEmailVerification } from "@/lib/email-verify";
import { buildVerifyEmail } from "@/lib/emails/verify-email";
import { publicUrl } from "@/lib/public-url";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await parseJson(req, SignupDto);
  if (!parsed.ok) return parsed.response;
  const { email, password, jurisdiction, tosAccepted, privacyAccepted } = parsed.data;

  if (!tosAccepted || !privacyAccepted) {
    return jsonError(400, "must_accept_tos_and_privacy");
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Generic failure to avoid user enumeration on the signup surface.
      return jsonError(409, "signup_failed");
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        jurisdiction,
        tosAcceptedAt: now,
        privacyAcceptedAt: now,
        // dob, ageVerifiedAt, ageVerificationLevel are set by the age gate
        // on first login, not at account creation.
      },
    });

    // Phase 34 Feature C: email verification. The user is created WITHOUT
    // emailVerifiedAt; the (protected) layout gate keeps them on /verify-email
    // until they click the link. We still issue the auth cookie below so they
    // can reach /verify-email and hit the resend endpoint. Replaces the old
    // welcome email; verification IS the welcome now.
    try {
      const { rawToken } = await issueEmailVerification(user.id, email);
      // Build the verify link on the PUBLIC origin so the button + copy-link
      // never point at the container-internal localhost in prod. See
      // lib/public-url.ts.
      const link = publicUrl(req, `/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`);
      const { subject, html, text } = buildVerifyEmail(link);
      await sendEmail({ to: email, subject, html, text });
    } catch {
      // Best-effort: never block signup on email issues; the user can resend.
    }

    const token = await signAuthToken(user.id);
    const res = jsonOk({ userId: user.id });
    setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, token);
    return res;
  } catch (err) {
    return jsonError(500, "db_error", { detail: String(err).slice(0, 300) });
  }
}
