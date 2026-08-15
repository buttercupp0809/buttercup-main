import { prisma } from "@buttercupp/database";
import { ConsentAcceptDto } from "@buttercupp/shared";
import { getAuthUserId } from "@/lib/auth";
import { POLICY_VERSION } from "@/lib/consent";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";

export const runtime = "nodejs";

// Single consent-recording choke point. Does not trust any client cookie;
// the User row written here is the record.
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return jsonError(401, "unauthenticated");

  const parsed = await parseJson(req, ConsentAcceptDto);
  if (!parsed.ok) return parsed.response;
  const { policyVersion } = parsed.data;

  // Defends against a stale modal (older client bundle, back-forward cache)
  // silently accepting an old policy version.
  if (policyVersion !== POLICY_VERSION) return jsonError(409, "stale_policy_version");

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { ageVerifiedAt: true },
  });
  if (!existing) return jsonError(401, "unauthenticated");

  const now = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: {
      consentAcceptedAt: now,
      acceptedPolicyVersion: POLICY_VERSION,
      tosAcceptedAt: now,
      privacyAcceptedAt: now,
      // This modal is the entry gate, so it may be the first age
      // confirmation; only stamp it if the user has never been through the
      // age gate, matching how /api/age/verify records self-declared
      // verification.
      ...(existing.ageVerifiedAt === null
        ? { ageVerifiedAt: now, ageVerificationLevel: "self_declared" }
        : {}),
    },
  });

  return jsonOk();
}
