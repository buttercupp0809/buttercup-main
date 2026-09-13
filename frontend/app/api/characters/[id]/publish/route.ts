// Publish gate. Runs moderation BEFORE flipping visibility to public. A
// rejected character stays private and returns the reasons so the wizard
// UI can surface them.

import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { requireAuth, signAuthToken } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";
import { moderateCharacter } from "@/lib/character-snapshot";
import { AUTH_COOKIE } from "@/lib/constants";
import type { CreateCharacterInput } from "@buttercupp/shared";

// Fire-and-forget: ask the backend to start a per-character LoRA training run
// once a character goes public. BullMQ lives in the backend workspace (frontend
// has no queue dep), so we proxy over the same short-lived-token call the
// creation-images flow uses. Non-blocking + best-effort: publish already
// succeeded, and the backend's duplicate guard makes a repeat publish idempotent.
async function triggerLoraTraining(characterId: string, userId: string): Promise<void> {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  try {
    const token = await signAuthToken(userId);
    await fetch(`${backendUrl}/media/character/${characterId}/train-lora`, {
      method: "POST",
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
    });
  } catch {
    // Backend unreachable (e.g. not running this dev session). Training simply
    // does not start; the user can trigger it later. Never blocks publish.
  }
}

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

  // Auto-train the character's LoRA now that it is public (on-publish policy).
  // Best-effort; never blocks the publish response.
  await triggerLoraTraining(id, user.id);

  return NextResponse.json({ ok: true });
}
