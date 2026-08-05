import { characterListQuerySchema } from "@buttercupp/shared";
import { listCharacters, getFacetTags } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { viewerAllowsMature } from "@buttercupp/database";
import { GalleryToolbar } from "@/components/gallery/GalleryToolbar";
import { CharacterGrid } from "@/components/gallery/CharacterGrid";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function flatten(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) out[k] = v.join(",");
    else if (typeof v === "string") out[k] = v;
  }
  return out;
}

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const parsed = characterListQuerySchema.safeParse(flatten(sp));
  const query = parsed.success
    ? parsed.data
    : characterListQuerySchema.parse({});

  const viewer = await getViewer();
  const [{ items, nextCursor }, availableTags] = await Promise.all([
    listCharacters(query, viewer),
    getFacetTags(viewer),
  ]);
  const mature = viewerAllowsMature(viewer);

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Discover</h1>
        <p
          className="text-sm"
          style={{ color: "hsl(var(--buttercupp-muted, 215 16% 47%))" }}
        >
          Real personas, live characters. Sort, search, and pick your companion.
        </p>
      </div>
      <div className="mb-6">
        <GalleryToolbar viewerAllowsMature={mature} availableTags={availableTags} />
      </div>
      <CharacterGrid
        initialItems={items}
        initialNextCursor={nextCursor}
        viewerAllowsMature={mature}
      />
    </section>
  );
}
