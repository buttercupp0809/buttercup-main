import Link from "next/link";
import type { CharacterCardDTO } from "@buttercupp/shared";
import { cn } from "@/lib/utils";
import { taglineFrom } from "@/lib/text";

// Marketing variant of the gallery character card: image-forward, gradient
// scrim with a name + tagline overlay. Mature gating mirrors
// components/gallery/CharacterCard.tsx exactly: for an unverified viewer, a
// mature character shows a blurred image plus an "18+ verify to view" chip
// instead of the clear picture.

export interface PersonaPreviewCardProps {
  character: CharacterCardDTO;
  viewerAllowsMature: boolean;
  priority?: boolean;
}

export function PersonaPreviewCard({ character, viewerAllowsMature, priority }: PersonaPreviewCardProps) {
  const gated = character.contentRating === "mature" && !viewerAllowsMature;
  const tagline = taglineFrom(character.bio);
  return (
    <Link
      href={`/characters/${character.id}`}
      data-testid="persona-preview"
      className="group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-md ring-1 ring-slate-200 transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 dark:ring-slate-700"
    >
      {character.avatarUrl ? (
        <img
          src={character.avatarUrl}
          alt={character.name}
          loading={priority ? "eager" : "lazy"}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105",
            gated && "blur-2xl scale-110",
          )}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-4xl font-semibold text-slate-500 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300">
          {character.name[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <span
        aria-hidden
        className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow ring-2 ring-black/30"
      />
      <div className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur">
        {character.contentRating}
      </div>
      {gated ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/60 text-center text-white">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium">
            18+ verify to view
          </span>
        </div>
      ) : null}
      <div className="relative z-10 mt-auto flex flex-col gap-1 p-4 text-white">
        <h3 className="text-lg font-semibold tracking-tight drop-shadow">{character.name}</h3>
        {tagline ? (
          <p className="line-clamp-2 text-sm text-white/85 drop-shadow-sm">{tagline}</p>
        ) : null}
      </div>
    </Link>
  );
}
