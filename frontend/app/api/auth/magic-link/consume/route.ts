import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { consumeMagicLink } from "@/lib/magic-link";
import { signAuthToken, setAuthCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeMagicLink(token, "login");
  if (!result.ok || !result.userId) {
    return NextResponse.redirect(new URL("/login?error=magic_link_invalid", url), 302);
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=user_missing", url), 302);
  }

  const authToken = await signAuthToken(user.id);
  const needsGate =
    !user.ageVerifiedAt ||
    user.ageVerificationLevel === "none" ||
    !user.tosAcceptedAt ||
    !user.privacyAcceptedAt;

  const dest = needsGate ? "/age-gate" : "/dashboard";
  const res = NextResponse.redirect(new URL(dest, url), 302);
  setAuthCookie(res, authToken);
  return res;
}
