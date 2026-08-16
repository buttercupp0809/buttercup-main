import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { patchCharacterInputSchema, styleWireToEnum, createCharacterInputSchema } from "@buttercupp/shared";
import { getCharacterDetail, nextVersionNo } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { jsonError } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { buildCharacterSystemPrompt } from "@/lib/character-snapshot";
import { deleteS3Keys, extractS3Key } from "@/lib/s3-delete";
import { ZodError } from "zod";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  try {
    const detail = await getCharacterDetail(id, viewer);
    if (!detail) return jsonError(404, "not_found");
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof TypeError) return jsonError(400, "invalid_id");
    throw err;
  }
}

// PATCH creates a NEW immutable CharacterVersion. Prior versions are never
// mutated; existing conversations pin their own version so persona history
// is preserved.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  let patch;
  try {
    patch = patchCharacterInputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return jsonError(400, "validation_failed", { issues: err.issues });
    return jsonError(400, "invalid_body");
  }

  const owned = await prisma.character.findFirst({
    where: { id, ownerUserId: user.id },
    include: {
      currentVersion: {
        include: { appearanceSheet: true, voiceProfile: true },
      },
    },
  });
  if (!owned || !owned.currentVersion) return jsonError(404, "not_found");

  // Merge patch onto the current version to build the next full draft. The
  // snapshot builder needs a fully-populated CreateCharacterInput.
  const current = owned.currentVersion;
  const appearance = current.appearanceSheet;
  const merged = createCharacterInputSchema.safeParse({
    style: patch.style ?? (owned.style === "threeD" ? "3d" : owned.style),
    name: patch.name ?? owned.name,
    age: patch.age ?? owned.age,
    gender: patch.gender ?? owned.gender,
    avatarKey: patch.avatarKey,
    traits: patch.traits ?? (appearance ? (appearance.traits as object) : {}),
    stylePrompt: patch.stylePrompt ?? appearance?.stylePrompt ?? "",
    negativePrompt: patch.negativePrompt ?? appearance?.negativePrompt ?? "",
    referenceImageKeys: patch.referenceImageKeys ?? appearance?.referenceImageKeys ?? [],
    backstory: patch.backstory ?? current.backstory,
    traitTags: patch.traitTags ?? owned.tags,
    behavioralInstructions: patch.behavioralInstructions ?? current.behavioralInstructions,
    greeting: patch.greeting ?? current.greeting,
    voiceProfile: patch.voiceProfile ?? {
      provider: current.voiceProfile?.provider ?? "system",
      voiceId: current.voiceProfile?.voiceId ?? "default",
    },
    bio: patch.bio ?? owned.bio,
    visibility: patch.visibility ?? owned.visibility,
    contentRating: patch.contentRating ?? owned.contentRating,
  });
  if (!merged.success) return jsonError(400, "invalid_merge", { issues: merged.error.issues });

  const snapshot = buildCharacterSystemPrompt(merged.data);

  const nextVersion = await prisma.$transaction(async (tx) => {
    const appearanceRow = await tx.appearanceSheet.create({
      data: {
        traits: merged.data.traits as unknown as object,
        stylePrompt: merged.data.stylePrompt,
        negativePrompt: merged.data.negativePrompt ?? "",
        referenceImageKeys: merged.data.referenceImageKeys ?? [],
      },
    });
    const voiceRow = await tx.voiceProfile.create({
      data: {
        provider: merged.data.voiceProfile.provider,
        voiceId: merged.data.voiceProfile.voiceId,
        params: {},
      },
    });
    // nextVersionNo (Build step 6) runs INSIDE this transaction so the
    // aggregate read and the insert commit atomically together; the
    // previous implementation read the max versionNo outside the
    // transaction, leaving a race window where two concurrent PATCHes could
    // both compute the same next version number.
    const version = await tx.characterVersion.create({
      data: {
        characterId: id,
        versionNo: await nextVersionNo(tx, id),
        personality: merged.data.traitTags.join(", "),
        backstory: merged.data.backstory,
        behavioralInstructions: merged.data.behavioralInstructions,
        greeting: merged.data.greeting,
        appearanceSheetId: appearanceRow.id,
        voiceProfileId: voiceRow.id,
        systemPromptSnapshot: snapshot,
      },
    });
    await tx.character.update({
      where: { id },
      data: {
        currentVersionId: version.id,
        name: merged.data.name,
        age: merged.data.age,
        gender: merged.data.gender,
        bio: merged.data.bio,
        tags: merged.data.traitTags,
        style: styleWireToEnum(merged.data.style),
        contentRating: merged.data.contentRating,
      },
    });
    return version;
  });

  return NextResponse.json({ id, versionId: nextVersion.id, versionNo: nextVersion.versionNo });
}

// DELETE removes the character AND every S3 object it owns (generated
// avatars via MediaAsset.s3Key, canonical images via CharacterMedia.url).
// Owner-only. DB-side cascades handle CharacterVersion, CharacterMedia,
// Conversation, Message; MediaAsset has a nullable characterId with no
// FK, so we delete those rows explicitly before dropping the character.
// S3 cleanup is best-effort: a bucket-side failure never rolls back the
// DB delete, so the row is gone the moment the user confirms.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  const owned = await prisma.character.findFirst({
    where: { id, ownerUserId: user.id },
    select: { id: true },
  });
  if (!owned) return jsonError(404, "not_found");

  // Collect keys BEFORE the DB delete: once CharacterMedia cascades out
  // we lose the pointer. Both writer surfaces (MediaAsset lifecycle +
  // canonical CharacterMedia) can point at the same S3 object, so we
  // dedupe by identity before hitting S3.
  const [assetRows, mediaRows] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { characterId: id, userId: user.id },
      select: { s3Key: true },
    }),
    prisma.characterMedia.findMany({
      where: { characterId: id },
      select: { url: true },
    }),
  ]);

  const keySet = new Set<string>();
  for (const row of assetRows) {
    const k = extractS3Key(row.s3Key);
    if (k) keySet.add(k);
  }
  for (const row of mediaRows) {
    const k = extractS3Key(row.url);
    if (k) keySet.add(k);
  }

  // DB delete first, in a transaction. Cascade takes care of
  // CharacterVersion, CharacterMedia, Conversation, and Message rows.
  // MediaAsset lacks a FK-cascade so we deleteMany explicitly, scoped to
  // (character, owner) so no cross-user rows can be swept.
  try {
    await prisma.$transaction([
      prisma.mediaAsset.deleteMany({ where: { characterId: id, userId: user.id } }),
      prisma.character.delete({ where: { id } }),
    ]);
  } catch (err) {
    // A Restrict FK (e.g. an active Conversation referencing a pinned
    // CharacterVersion elsewhere) or a race condition where the row is
    // already gone. Surface as a soft failure; the client shows a toast.
    const msg = err instanceof Error ? err.message : "delete_failed";
    return jsonError(409, "delete_failed", { message: msg });
  }

  const s3Report = await deleteS3Keys(Array.from(keySet));

  return NextResponse.json({
    ok: true,
    id,
    s3: {
      attempted: s3Report.attempted,
      deleted: s3Report.deleted,
      skipped: s3Report.skipped,
      errored: s3Report.errors.length,
    },
  });
}
