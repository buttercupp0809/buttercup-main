// Request a password-reset link. Always returns a generic success so the
// endpoint cannot be used to enumerate which emails have accounts. When a
// matching password account exists we sign a short-lived reset JWT and email
// the link. OAuth-only accounts (no passwordHash) are silently skipped.
import { prisma } from "@buttercupp/database";
import { ForgotPasswordDto } from "@buttercupp/shared";
import { signResetToken } from "@/lib/auth";
import { jsonOk, parseJson } from "@/lib/api-helpers";
import { sendEmail, emailShell } from "@/lib/email";
import { publicUrl } from "@/lib/public-url";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await parseJson(req, ForgotPasswordDto);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.passwordHash) {
    const token = await signResetToken(user.id);
    // Build the reset link on the PUBLIC origin so it never embeds the
    // container-internal localhost in prod. See lib/public-url.ts.
    const link = publicUrl(req, `/reset-password?token=${encodeURIComponent(token)}`);
    await sendEmail({
      to: email,
      subject: "Reset your ButterCupp password",
      html: emailShell(
        "Reset your password",
        `<p style="color:#c9c9d4;font-size:14px">Click the button below to choose a new password. This link expires shortly. If you did not request this, you can ignore this email.</p>
         <p style="margin:20px 0"><a href="${link}" style="background:#f2668b;color:#0b0b0f;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;display:inline-block">Reset password</a></p>
         <p style="color:#8a8a99;font-size:12px;word-break:break-all">${link}</p>`,
      ),
      text: `Reset your ButterCupp password: ${link}`,
    });
  }

  return jsonOk({ sent: true });
}
