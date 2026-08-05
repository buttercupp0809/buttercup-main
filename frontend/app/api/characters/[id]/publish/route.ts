// Publish gate. Runs moderation BEFORE flipping visibility to public. A
// rejected character stays private and returns the reasons so the wizard
// UI can surface them.

import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";
import { moderateCharacter } from "@/lib/character-snapshot";
import type { CreateCharacterInput } from "@buttercupp/shared";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  const character = await prisma.character.findFirst({
    where: { id, ownerUserId: user.id },
    include: {
      currentVersion: {
        include: { appearanceSheet: true, voiceProfile: true },
      },
    },
  });
  if (!character || !character.currentVersion) return jsonError(404, "not_found");
  const version = character.currentVersion;
  const appearance = version.appearanceSheet;

  // Reconstruct the CreateCharacterInput shape from the stored rows to run
  // the moderation gate. The system prompt is the source of truth for
  // published behavior, but the moderator scans user-visible fields.
  const draft: CreateCharacterInput = {
    style: character.style === "threeD" ? "3d" : character.style,
    name: character.name,
    age: character.age,
    gender: character.gender,
    traits: (appearance?.traits ?? {}) as CreateCharacterInput["traits"],
    stylePrompt: appearance?.stylePrompt ?? "",
    negativePrompt: appearance?.negativePrompt ?? "",
    referenceImageKeys: appearance?.referenceImageKeys ?? [],
    backstory: version.backstory,
    traitTags: character.tags,
    behavioralInstructions: version.behavioralInstructions,
    greeting: version.greeting,
    voiceProfile: {
      provider: version.voiceProfile?.provider ?? "system",
      voiceId: version.voiceProfile?.voiceId ?? "default",
    },
    bio: character.bio,
    visibility: "public",
    contentRating: character.contentRating,
  };

  const modResult = moderateCharacter(draft);
  if (!modResult.ok) {
    await prisma.character.update({
      where: { id },
      data: { moderationStatus: "rejected", visibility: "private" },
    });
    return NextResponse.json(
      { ok: false, reasons: modResult.reasons },
      { status: 422 },
    );
  }

  await prisma.character.update({
    where: { id },
    data: {
      moderationStatus: "approved",
      visibility: "public",
    },
  });

  return NextResponse.json({ ok: true });
}
