import { prisma } from "@poppy/database";
import { AgeGateDto, computeAgeYears, MIN_AGE_YEARS } from "@poppy/shared";
import { getAuthUserId } from "@/lib/auth";
import { getAgeProvider } from "@/lib/age-verification/provider";
import { requiresVendorVerification } from "@/lib/age-verification/jurisdiction";
import { jsonError, jsonOk, parseJson } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return jsonError(401, "unauthenticated");

  const parsed = await parseJson(req, AgeGateDto);
  if (!parsed.ok) return parsed.response;
  const { dob, jurisdiction, tosAccepted, privacyAccepted } = parsed.data;

  if (computeAgeYears(dob) < MIN_AGE_YEARS) return jsonError(400, "under_min_age");
  if (!tosAccepted || !privacyAccepted) return jsonError(400, "must_accept_tos_and_privacy");

  const provider = getAgeProvider();
  const result = await provider.verify({ userId, dob, jurisdiction });

  const now = new Date();
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      dob,
      jurisdiction,
      tosAcceptedAt: now,
      privacyAcceptedAt: now,
      ageVerifiedAt: now,
      ageVerificationLevel: result.level,
    },
  });

  await prisma.ageVerification.create({
    data: {
      userId,
      provider: result.provider,
      level: result.level,
      status: result.status,
      evidenceRef: result.evidenceRef ?? null,
      verifiedAt: result.status === "verified" ? now : null,
    },
  });

  // Whether the user must additionally pass vendor verification to unlock
  // mature content. False today; extend when per-region rules land.
  const vendorRequired = requiresVendorVerification({
    jurisdiction: user.jurisdiction,
    contentRating: "mature",
  });

  return jsonOk({
    level: result.level,
    vendorRequiredForMature: vendorRequired,
  });
}
