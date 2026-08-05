import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { SignupDto, computeAgeYears, MIN_AGE_YEARS } from "@buttercupp/shared";
import { hashPassword } from "@/lib/password";
import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";
import { sendEmail, emailShell } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await parseJson(req, SignupDto);
  if (!parsed.ok) return parsed.response;
  const { email, password, dob, jurisdiction, tosAccepted, privacyAccepted } = parsed.data;

  // Second server-side recompute so a client-tampered payload cannot slip
  // through. The Zod refine already caught this; belt-and-braces here because
  // the age gate is the entire compliance surface.
  if (computeAgeYears(dob) < MIN_AGE_YEARS) {
    return jsonError(400, "under_min_age");
  }
  if (!tosAccepted || !privacyAccepted) {
    return jsonError(400, "must_accept_tos_and_privacy");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
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
      dob,
      jurisdiction,
      tosAcceptedAt: now,
      privacyAcceptedAt: now,
      ageVerifiedAt: now,
      ageVerificationLevel: "self_declared",
    },
  });

  await prisma.ageVerification.create({
    data: {
      userId: user.id,
      provider: "self_declared",
      level: "self_declared",
      status: "verified",
      verifiedAt: now,
    },
  });

  // Welcome email, best-effort: never block or fail signup on email issues.
  void sendEmail({
    to: email,
    subject: "Welcome to ButterCupp",
    html: emailShell(
      "Welcome to ButterCupp",
      `<p style="color:#c9c9d4;font-size:14px">Your account is ready. Pick a companion, start chatting, and make it yours.</p>
       <p style="margin:20px 0"><a href="${new URL(req.url).origin}/dashboard" style="background:#f2668b;color:#0b0b0f;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;display:inline-block">Open ButterCupp</a></p>`,
    ),
    text: "Welcome to ButterCupp. Your account is ready.",
  }).catch(() => null);

  const token = await signAuthToken(user.id);
  const res = jsonOk({ userId: user.id });
  setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, token);
  return res;
}
