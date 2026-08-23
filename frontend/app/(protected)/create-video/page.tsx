// "Create Video": pick ANY character in the system, describe a short clip,
// choose duration / aspect ratio / quality, and generate an image-to-video
// render. Server component loads the full character catalog the viewer can see
// (public + approved, same source as /discover) merged with the user's own
// companions, deduped, and hands them to the interactive client form.
import { requireAuth } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";
import { listCharacters } from "@/lib/characters";
import { listCompanions } from "@/lib/companions";
import { characterListQuerySchema } from "@buttercupp/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { CreateVideoForm } from "@/components/create-video/CreateVideoForm";

export const dynamic = "force-dynamic";

interface PickerCharacter {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export default async function CreateVideoPage() {
  const user = await requireAuth();
  const viewer = await getViewer();

  // The public catalog (max page = 48) plus the user's own companions. Merging
  // covers the user's private/unapproved characters that the catalog excludes.
  const query = { ...characterListQuerySchema.parse({}), limit: 48 };
  const [catalog, own] = await Promise.all([
    listCharacters(query, viewer),
    listCompanions(user.id),
  ]);

  const byId = new Map<string, PickerCharacter>();
  for (const c of own) byId.set(c.id, { id: c.id, name: c.name, avatarUrl: c.avatarUrl });
  for (const it of catalog.items) {
    if (!byId.has(it.id)) byId.set(it.id, { id: it.id, name: it.name, avatarUrl: it.avatarUrl });
  }
  const characters = [...byId.values()];

  return (
    <section className="mx-auto max-w-5xl px-6 px-safe py-10 pb-safe sm:py-12">
      <PageHeader
        eyebrow="Studio"
        title="Create a"
        accent="video"
        description="Bring any character to life. Pick one, describe a short clip, choose a look, and we will render it for you."
      />
      <CreateVideoForm characters={characters} />
    </section>
  );
}
