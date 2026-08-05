import { prisma } from "@buttercupp/database";
import { LoginDto } from "@buttercupp/shared";
import { verifyPassword } from "@/lib/password";
import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";

const GENERIC_ERROR = "invalid_credentials";

export async function POST(req: Request) {
  const parsed = await parseJson(req, LoginDto);
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    // Same error whether the user doesn't exist or has no password (OAuth-only
    // account). Prevents user enumeration.
    return jsonError(401, GENERIC_ERROR);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return jsonError(401, GENERIC_ERROR);

  const token = await signAuthToken(user.id);
  const res = jsonOk({ userId: user.id });
  setAuthCookie(res as unknown as { cookies: NextResponse["cookies"] }, token);
  return res;
}
