// In-app Discover. Same data + components as the public /gallery, but rendered
// INSIDE the protected dark app shell (sidebar + dark theme) so clicking
// "Discover" in the sidenav never bounces the user out to the light public
// shell. Auth + age gate already enforced by (protected)/layout.tsx.
import Link from "next/link";
import { characterListQuerySchema } from "@buttercupp/shared";
import { listCharacters, getFacetTags } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { viewerAllowsMature } from "@buttercupp/database";
import { GalleryToolbar } from "@/components/gallery/GalleryToolbar";
import { CharacterGrid } from "@/components/gallery/CharacterGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

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
    <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Explore"
        title="Meet your next"
        accent="companion"
        description="Real personas, live characters. Sort, search, and pick who you want to talk to."
        actions={
          <Link href="/create">
            <Button size="sm">Create your own</Button>
          </Link>
        }
      />
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
