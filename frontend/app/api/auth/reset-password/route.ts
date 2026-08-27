// Consume a password-reset link: verify the reset JWT, enforce the strong
// password rule (same as signup), update the hash, and sign the user in.
import type { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { ResetPasswordDto } from "@buttercupp/shared";
import { verifyResetToken, signAuthToken, setAuthCookie, recordLogin } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { jsonOk, jsonError, parseJson } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await parseJson(req, ResetPasswordDto);
  if (!parsed.ok) return parsed.response;
  const { token, password } = parsed.data;

  const userId = await verifyResetToken(token);
  if (!userId) return jsonError(400, "invalid_or_expired_token");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return jsonError(400, "invalid_or_expired_token");

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Sign the user in after a successful reset so they land in the app.
  const authToken = await signAuthToken(userId);
  const res = jsonOk({ ok: true });
  setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, authToken);
  void recordLogin(userId, req);
  return res;
}
