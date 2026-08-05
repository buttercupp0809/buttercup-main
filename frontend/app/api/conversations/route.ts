// Conversation start endpoint. Called by the chat page when the user opens
// a character for the first time (or when a fresh conversation is needed).
// Idempotently reuses the most recent open conversation for the user +
// character pair.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@buttercupp/database";
import { requireAgeVerified } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

const startDto = z.object({
  characterId: z.string().min(1).max(64),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireAgeVerified();
  let body;
  try {
    body = startDto.parse(await req.json());
  } catch {
    return jsonError(400, "invalid_body");
  }
  const characterId = assertSafeId(body.characterId, "characterId");

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { currentVersion: true },
  });
  if (!character || !character.currentVersionId) return jsonError(404, "character_not_found");
  if (character.contentRating === "mature") {
    const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) return jsonError(403, "age_verification_required");
  }

  const existing = await prisma.conversation.findFirst({
    where: { userId: user.id, characterId },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) return NextResponse.json({ id: existing.id, reused: true });

  const conv = await prisma.conversation.create({
    data: {
      userId: user.id,
      characterId,
      characterVersionId: character.currentVersionId,
    },
  });
  return NextResponse.json({ id: conv.id, reused: false });
}
