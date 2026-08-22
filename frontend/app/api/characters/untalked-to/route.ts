// Picks one public/approved character the current user has NOT talked to yet.
// Backs the recurring upgrade-nudge popup (UpgradeModalProvider): a free user
// with no active plan sees a fresh face every 30 minutes. Returns
// { character: null } (HTTP 200) when the user has talked to everyone or no
// eligible character exists, so the client can silently skip the popup instead
// of treating an empty result as an error.

import { NextResponse } from "next/server";
import { prisma, CHARACTER_MEDIA_ORDER_BY } from "@buttercupp/database";
import { getViewer } from "@/lib/viewer";
import { primaryImageFrom } from "@/lib/characters";

export const runtime = "nodejs";

export async function GET() {
  // Authenticated-only surface: same viewer resolution the gallery uses, which
  // also carries ageVerified so we never surface a mature character to a
  // viewer who cannot see it. A visitor (id === null) has no conversations and
  // no popup, so short-circuit.
  const viewer = await getViewer();
  if (viewer.id === null) {
    return NextResponse.json({ character: null });
  }

  // characterIds the user already has a conversation with. Conversation has
  // @@unique([userId, characterId]) so one row === "has talked to".
  const talkedTo = await prisma.conversation.findMany({
    where: { userId: viewer.id },
    select: { characterId: true },
  });
  const talkedToIds = talkedTo.map((c) => c.characterId);

  // Public + approved characters not in the talked-to set, mature-gated the
  // same way buildCharacterWhere gates the gallery. Ordering by popularityScore
  // then taking a small window, then picking randomly inside it, keeps the pick
  // fresh without a full-table random scan.
  const candidates = await prisma.character.findMany({
    where: {
      visibility: "public",
      moderationStatus: "approved",
      ...(viewer.ageVerified ? {} : { contentRating: "sfw" as const }),
      ...(talkedToIds.length > 0 ? { id: { notIn: talkedToIds } } : {}),
    },
    orderBy: [{ popularityScore: "desc" }, { id: "desc" }],
    take: 24,
    include: {
      media: {
        // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
        // schema.prisma. Ordering imported from the canonical constant so this
        // never drifts from lib/characters.ts / lib/chats.ts.
        where: { kind: "image", hidden: false },
        orderBy: CHARACTER_MEDIA_ORDER_BY,
      },
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ character: null });
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  // Same media-pick + signAssetUrl logic the dashboard/card avatar uses.
  const imageUrl = primaryImageFrom(pick.media);

  return NextResponse.json({
    character: {
      id: pick.id,
      name: pick.name,
      imageUrl,
    },
  });
}
