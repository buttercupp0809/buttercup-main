import type { CharacterDraft } from "@buttercupp/shared";

// Mirrors the Phase 03 CharacterCard layout so the creator sees exactly
// what the gallery will render. Rendered in dark-app mode so it matches
// the rest of the wizard rather than the public slate/white card.
//
// Mobile is a compact horizontal card: a tall portrait would eat the whole
// screen and hide the form. Desktop keeps the full portrait card.
export function PreviewCard({ draft }: { draft: CharacterDraft }) {
  const name = draft.name ?? "Untitled";
  const bio = draft.bio ?? "Add a short bio in step 4.";
  const tags = draft.traitTags ?? [];
  return (
    <div className="bc-media flex flex-row gap-3 overflow-hidden rounded-xl border border-[hsl(var(--bc-border-strong))] md:flex-col md:gap-0">
      <div className="flex aspect-[3/4] w-28 shrink-0 items-center justify-center bg-[hsl(var(--bc-surface-2))] md:aspect-[4/5] md:w-full">
        <span className="font-display text-3xl font-semibold text-[hsl(var(--bc-cream))] md:text-4xl">
          {name[0]}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3 md:gap-2 md:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-display text-base font-semibold tracking-tight text-[hsl(var(--bc-cream))]">
            {name}
          </h3>
          <span className="shrink-0 text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--bc-amber))]">
            preview
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-[hsl(var(--bc-muted))]">{bio}</p>
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full border border-[hsl(var(--bc-cream)/0.14)] bg-[hsl(var(--bc-cream)/0.08)] px-2 py-0.5 text-[0.6875rem] text-[hsl(var(--bc-cream)/0.85)]"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
