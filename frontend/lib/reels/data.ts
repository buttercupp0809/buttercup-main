// Public reel data for the marketing landing carousel. No per-user like state
// (the landing is unauthenticated); just enough to render a preview + link.
// Never throws: returns [] on an empty/unreachable DB so the section hides.

import { prisma } from "@buttercupp/database";
import { pickPersonaImage } from "@/lib/persona-images";

export interface PublicReel {
  id: string;
  src: string;
  name: string;
  location: string;
  avatar: string;
  characterId: string;
}

export async function getPublicReels(limit = 12): Promise<PublicReel[]> {
  try {
    const vids = await prisma.characterMedia.findMany({
      where: { kind: "video" },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
      include: {
        character: {
          include: {
            media: {
              where: { kind: "image" },
              orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
              take: 1,
            },
          },
        },
      },
    });
    return vids.map((v) => ({
      id: v.id,
      src: v.url,
      name: v.character.name,
      location: v.character.location ?? "",
      avatar: v.character.media[0]?.url ?? pickPersonaImage(v.characterId),
      characterId: v.characterId,
    }));
  } catch {
    return [];
  }
}
