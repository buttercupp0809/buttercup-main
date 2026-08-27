import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { consumeMagicLink } from "@/lib/magic-link";
import { signAuthToken, setAuthCookie, recordLogin } from "@/lib/auth";
import { publicUrl } from "@/lib/public-url";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeMagicLink(token, "login");
  // Redirect targets are built on the PUBLIC origin, not req.url (which is the
  // container-internal localhost behind the Amplify proxy). See lib/public-url.
  if (!result.ok || !result.userId) {
    return NextResponse.redirect(publicUrl(req, "/login?error=magic_link_invalid"), 302);
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) {
    return NextResponse.redirect(publicUrl(req, "/login?error=user_missing"), 302);
  }

  const authToken = await signAuthToken(user.id);
  const needsGate =
    !user.ageVerifiedAt ||
    user.ageVerificationLevel === "none" ||
    !user.tosAcceptedAt ||
    !user.privacyAcceptedAt;

  const dest = needsGate ? "/age-gate" : "/dashboard";
  const res = NextResponse.redirect(publicUrl(req, dest), 302);
  setAuthCookie(res, authToken);
  void recordLogin(user.id, req);
  return res;
}
