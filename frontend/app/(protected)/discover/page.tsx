// In-app Discover. Same data + components as the public /gallery, but rendered
// INSIDE the protected dark app shell (sidebar + dark theme) so clicking
// "Discover" in the sidenav never bounces the user out to the light public
// shell. Auth + age gate already enforced by (protected)/layout.tsx.
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

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const parsed = characterListQuerySchema.safeParse(flatten(sp));
  const query = parsed.success ? parsed.data : characterListQuerySchema.parse({});

  const viewer = await getViewer();
  const [{ items, nextCursor }, availableTags] = await Promise.all([
    listCharacters(query, viewer),
    getFacetTags(viewer),
  ]);
  const mature = viewerAllowsMature(viewer);

  return (
    <section className="mx-auto max-w-6xl px-5 px-safe py-5 sm:px-6 sm:py-8">
      {/*
        Tight on phones by design: heading, one line, then faces. The old
        four-line header plus a wrapping filter block pushed the first portrait
        entirely below the fold on a 390px screen.
      */}
      <div className="mb-4 flex items-baseline justify-between gap-3 sm:mb-6">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-tight sm:text-4xl">
          Discover
        </h1>
        <span
          className="tabular shrink-0 text-xs"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          {items.length} on this page
        </span>
      </div>
      <div className="mb-4 sm:mb-6">
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
