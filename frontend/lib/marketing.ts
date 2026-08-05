// Marketing landing data helper. Goes through the same read path the gallery
// uses (listCharacters + getViewer) so the hero shows REAL public characters
// with correct mature gating. Never throws: on any error (DB down, empty DB,
// invalid query), returns an empty items array so `/` renders skeleton tiles
// instead of a 500.

import { characterListQuerySchema, type CharacterCardDTO } from "@poppy/shared";
import { viewerAllowsMature } from "@poppy/database";
import { listCharacters } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";

// `taglineFrom` lives in `@/lib/text` so client components can use it
// without pulling `getViewer` -> `@/lib/auth` -> `next/headers` into their
// bundle (which Next rejects at build time).
export { taglineFrom } from "@/lib/text";

export interface LandingCharactersResult {
  items: CharacterCardDTO[];
  viewerAllowsMature: boolean;
}

export async function getLandingCharacters(): Promise<LandingCharactersResult> {
  try {
    const viewer = await getViewer();
    const query = characterListQuerySchema.parse({ sort: "popular", limit: 12 });
    const { items } = await listCharacters(query, viewer);
    return { items, viewerAllowsMature: viewerAllowsMature(viewer) };
  } catch {
    return { items: [], viewerAllowsMature: false };
  }
}
