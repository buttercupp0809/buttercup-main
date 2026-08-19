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
    <section className="mx-auto max-w-6xl px-6 px-safe py-10">
      <div className="mb-8 flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col items-start gap-3">
          <span className="bc-pill text-[hsl(var(--bc-honey))]">
            <span className="bc-pulse-ring h-1.5 w-1.5 rounded-full bg-[hsl(var(--bc-success))]" />
            {items.length > 0 ? `${items.length} awake on this page` : "Roster"}
          </span>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em] text-[hsl(var(--bc-cream))] sm:text-5xl">
            Find the one who fits.
          </h1>
        </div>
        <p className="max-w-[38ch] text-pretty text-sm text-[hsl(var(--bc-muted))]">
          Every persona here holds her own memory. Pick one, say hi, and the bond starts at Spark.
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
