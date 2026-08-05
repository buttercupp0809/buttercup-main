import { prisma } from "@buttercupp/database";
import { MagicLinkRequestDto } from "@buttercupp/shared";
import { issueMagicLink } from "@/lib/magic-link";
import { jsonOk, parseJson } from "@/lib/api-helpers";

export const runtime = "nodejs";

// Always returns 200 to prevent email enumeration. When the email is unknown
// we do NOT create a user and we do NOT issue a link; the response is a
// generic 200 so an attacker cannot distinguish "known" from "unknown".
export async function POST(req: Request) {
  const parsed = await parseJson(req, MagicLinkRequestDto);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const { rawToken } = await issueMagicLink(user.id, "login");
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const url = `${base}/api/auth/magic-link/consume?token=${encodeURIComponent(rawToken)}`;
    // Phase 01: log to console. Phase 13 wires an email provider.
    console.log(`[magic-link] to=${email} url=${url}`);
  }

  return jsonOk({ sent: true });
}
