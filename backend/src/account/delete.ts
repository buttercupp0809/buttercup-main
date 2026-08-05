// Irreversible account deletion. Runs in a Prisma transaction so a partial
// failure rolls back completely; no orphan rows.
//
// Retention exception: AuditLog rows are ANONYMIZED (userId nulled), not
// deleted, so SB 243 accountability history is preserved for the
// legally required window. Every other user-owned table is fully removed.

import { prisma } from "@buttercupp/database";
import { writeAuditLog } from "../utils/audit";
import { track } from "../analytics/tracker";

export async function deleteUserCascade(userId: string): Promise<{
  deleted: Record<string, number>;
  auditAnonymized: number;
}> {
  // Write the audit log BEFORE the transaction so the user identifier is
  // still present on the trail row we anonymize below.
  await writeAuditLog({
    action: "account.delete",
    userId,
    resource: `user:${userId}`,
    metadata: { irreversible: true },
  });

  const deleted = await prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {};

    // Message rows are FK'd through Conversation; Prisma cascade on
    // Conversation deletion cleans them up, but we count for the summary.
    counts.messages = (await tx.message.deleteMany({ where: { conversation: { userId } } })).count;
    counts.conversations = (await tx.conversation.deleteMany({ where: { userId } })).count;
    counts.memories = (await tx.memory.deleteMany({ where: { userId } })).count;
    counts.memorySummaries = (await tx.memorySummary.deleteMany({ where: { userId } })).count;
    counts.relationshipStates = (await tx.relationshipState.deleteMany({ where: { userId } })).count;
    counts.tokenLedger = (await tx.tokenLedger.deleteMany({ where: { userId } })).count;
    counts.mediaAssets = (await tx.mediaAsset.deleteMany({ where: { userId } })).count;
    counts.ageVerifications = (await tx.ageVerification.deleteMany({ where: { userId } })).count;
    counts.crisisEvents = (await tx.crisisEvent.deleteMany({ where: { userId } })).count;
    counts.magicLinks = (await tx.magicLink.deleteMany({ where: { userId } })).count;
    counts.subscriptions = (await tx.subscription.deleteMany({ where: { userId } })).count;
    counts.usageCounters = (await tx.usageCounter.deleteMany({ where: { userId } })).count;

    // Characters owned by the user: their CharacterVersions/AppearanceSheets
    // are relation-linked; delete versions first to avoid FK issues, then
    // characters. AppearanceSheet/VoiceProfile are shared by nothing else
    // when created via wizard so we drop the ones referenced by the
    // deleted versions.
    const owned = await tx.character.findMany({
      where: { ownerUserId: userId },
      include: { versions: true },
    });
    const ownedVersionIds = owned.flatMap((c) => c.versions.map((v) => v.id));
    const sheetIds = owned.flatMap((c) =>
      c.versions.map((v) => v.appearanceSheetId).filter((x): x is string => !!x),
    );
    const voiceIds = owned.flatMap((c) =>
      c.versions.map((v) => v.voiceProfileId).filter((x): x is string => !!x),
    );

    counts.characterVersions = (await tx.characterVersion.deleteMany({
      where: { id: { in: ownedVersionIds } },
    })).count;
    counts.characters = (await tx.character.deleteMany({ where: { ownerUserId: userId } })).count;
    counts.appearanceSheets = (await tx.appearanceSheet.deleteMany({
      where: { id: { in: sheetIds } },
    })).count;
    counts.voiceProfiles = (await tx.voiceProfile.deleteMany({
      where: { id: { in: voiceIds } },
    })).count;

    // Finally the user row itself.
    counts.user = (await tx.user.deleteMany({ where: { id: userId } })).count;
    return counts;
  });

  // Anonymize audit trail: retain rows for legal accountability but sever
  // the identifier. This step is intentionally outside the transaction so a
  // failure here does not roll back the deletion (the user has a legal
  // right to erasure that supersedes internal audit continuity).
  const anon = await prisma.auditLog.updateMany({
    where: { userId },
    data: { userId: null },
  });

  track("account_deleted", { irreversible: true }, undefined);

  return { deleted, auditAnonymized: anon.count };
}
