// GDPR / CCPA data export. Assembles every user-owned row into a single
// JSON bundle. MediaAsset entries include the S3 key but not the blob;
// consumers can fetch signed URLs separately. Sensitive fields
// (passwordHash) are redacted.

import { prisma } from "@poppy/database";

export interface UserExportBundle {
  exportedAt: string;
  user: Record<string, unknown>;
  conversations: unknown[];
  messages: unknown[];
  memories: unknown[];
  memorySummaries: unknown[];
  characters: unknown[];
  characterVersions: unknown[];
  appearanceSheets: unknown[];
  voiceProfiles: unknown[];
  relationshipStates: unknown[];
  tokenLedger: unknown[];
  subscription: unknown;
  mediaAssets: unknown[];
  ageVerifications: unknown[];
}

export async function buildUserExport(userId: string): Promise<UserExportBundle> {
  const [
    user,
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
  ] = await Promise.all([
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

  const versions = characters.flatMap((c) => c.versions);
  const appearanceSheets = versions.map((v) => v.appearanceSheet).filter(Boolean);
  const voiceProfiles = versions.map((v) => v.voiceProfile).filter(Boolean);

  return {
    exportedAt: new Date().toISOString(),
    user: userSafe,
    conversations,
    messages,
    memories,
    memorySummaries,
    characters: characters.map((c) => ({ ...c, versions: undefined })),
    characterVersions: versions.map((v) => ({ ...v, appearanceSheet: undefined, voiceProfile: undefined })),
    appearanceSheets,
    voiceProfiles,
    relationshipStates,
    tokenLedger,
    subscription,
    mediaAssets,
    ageVerifications,
  };
}
