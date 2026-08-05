// Frontend copies of the account operations. Structurally identical to
// backend/src/account/{export,delete}.ts; kept here so the Next.js API
// routes can consume them without a cross-workspace import. The backend
// modules remain the canonical spec.

import { prisma } from "@poppy/database";

export async function buildUserExport(userId: string) {
  const [user, conversations, messages, memories, memorySummaries, characters, relationshipStates, tokenLedger, subscription, mediaAssets, ageVerifications] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.conversation.findMany({ where: { userId } }),
    prisma.message.findMany({ where: { conversation: { userId } } }),
    prisma.memory.findMany({ where: { userId } }),
    prisma.memorySummary.findMany({ where: { userId } }),
    prisma.character.findMany({
      where: { ownerUserId: userId },
      include: { versions: { include: { appearanceSheet: true, voiceProfile: true } } },
    }),
    prisma.relationshipState.findMany({ where: { userId } }),
    prisma.tokenLedger.findMany({ where: { userId } }),
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.mediaAsset.findMany({ where: { userId } }),
    prisma.ageVerification.findMany({ where: { userId } }),
  ]);
  const { passwordHash: _pw, ...userSafe } = user as Record<string, unknown>;
  void _pw;
  return {
    exportedAt: new Date().toISOString(),
    user: userSafe,
    conversations,
    messages,
    memories,
    memorySummaries,
    characters,
    relationshipStates,
    tokenLedger,
    subscription,
    mediaAssets,
    ageVerifications,
  };
}

export async function deleteUserCascade(userId: string) {
  const counts = await prisma.$transaction(async (tx) => {
    const c: Record<string, number> = {};
    c.messages = (await tx.message.deleteMany({ where: { conversation: { userId } } })).count;
    c.conversations = (await tx.conversation.deleteMany({ where: { userId } })).count;
    c.memories = (await tx.memory.deleteMany({ where: { userId } })).count;
    c.memorySummaries = (await tx.memorySummary.deleteMany({ where: { userId } })).count;
    c.relationshipStates = (await tx.relationshipState.deleteMany({ where: { userId } })).count;
    c.tokenLedger = (await tx.tokenLedger.deleteMany({ where: { userId } })).count;
    c.mediaAssets = (await tx.mediaAsset.deleteMany({ where: { userId } })).count;
    c.ageVerifications = (await tx.ageVerification.deleteMany({ where: { userId } })).count;
    c.crisisEvents = (await tx.crisisEvent.deleteMany({ where: { userId } })).count;
    c.magicLinks = (await tx.magicLink.deleteMany({ where: { userId } })).count;
    c.subscriptions = (await tx.subscription.deleteMany({ where: { userId } })).count;
    c.usageCounters = (await tx.usageCounter.deleteMany({ where: { userId } })).count;
    const owned = await tx.character.findMany({
      where: { ownerUserId: userId },
      include: { versions: true },
    });
    const versionIds = owned.flatMap((o) => o.versions.map((v) => v.id));
    const sheetIds = owned.flatMap((o) =>
      o.versions.map((v) => v.appearanceSheetId).filter((x): x is string => !!x),
    );
    const voiceIds = owned.flatMap((o) =>
      o.versions.map((v) => v.voiceProfileId).filter((x): x is string => !!x),
    );
    c.characterVersions = (await tx.characterVersion.deleteMany({ where: { id: { in: versionIds } } })).count;
    c.characters = (await tx.character.deleteMany({ where: { ownerUserId: userId } })).count;
    c.appearanceSheets = (await tx.appearanceSheet.deleteMany({ where: { id: { in: sheetIds } } })).count;
    c.voiceProfiles = (await tx.voiceProfile.deleteMany({ where: { id: { in: voiceIds } } })).count;
    c.user = (await tx.user.deleteMany({ where: { id: userId } })).count;
    return c;
  });
  // Anonymize audit trail (retain rows, sever identifier) so SB 243 log
  // continuity is preserved even after the user is deleted.
  const anon = await prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } });
  return { deleted: counts, auditAnonymized: anon.count };
}
