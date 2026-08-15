// Phase 28: owner-only polling endpoint for the wizard finish screen (and
// any future edit-flow status UI). Summarizes the queued/processing/ready/
// failed counts for a character's CREATION-time image jobs (identified by
// meta.source === "creation", so a chat selfie the owner happens to request
// for their own character never pollutes this count) plus whether the
// character's free-display asset is ready.
import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import type { GenerationStatusResponse } from "@buttercupp/shared";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

const STATUSES = ["queued", "processing", "ready", "failed"] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let characterId: string;
  try {
    characterId = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { ownerUserId: true },
  });
  if (!character) return jsonError(404, "not_found");
  if (character.ownerUserId !== user.id) return jsonError(403, "forbidden");

  const [grouped, display] = await Promise.all([
    prisma.mediaAsset.groupBy({
      by: ["status"],
      where: {
        characterId,
        kind: "image",
        meta: { path: ["source"], equals: "creation" },
      },
      _count: { _all: true },
    }),
    prisma.characterMedia.findFirst({
      // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
      // schema.prisma.
      where: { characterId, isDisplay: true, hidden: false },
      select: { id: true },
    }),
  ]);

  const counts: Record<(typeof STATUSES)[number], number> = {
    queued: 0,
    processing: 0,
    ready: 0,
    failed: 0,
  };
  for (const row of grouped) {
    if ((STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as (typeof STATUSES)[number]] = row._count._all;
    }
  }

  const body: GenerationStatusResponse = {
    ...counts,
    // Named primaryReady on the wire (the field name this endpoint was
    // specified against); it reflects CharacterMedia.isDisplay, the
    // Phase-26 free-display flag, not CharacterMedia.isPrimary.
    primaryReady: display !== null,
  };
  return NextResponse.json(body);
}
