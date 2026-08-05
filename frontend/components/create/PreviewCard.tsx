import type { CharacterDraft } from "@poppy/shared";

// Mirrors the Phase 03 CharacterCard layout so the creator sees exactly
// what the gallery will render.
export function PreviewCard({ draft }: { draft: CharacterDraft }) {
  const name = draft.name ?? "Untitled";
  const bio = draft.bio ?? "Add a short bio in step 4.";
  const tags = draft.traitTags ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-slate-100 text-4xl text-slate-400 dark:bg-slate-800">
        {name[0]}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-semibold tracking-tight">{name}</h3>
        <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{bio}</p>
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
