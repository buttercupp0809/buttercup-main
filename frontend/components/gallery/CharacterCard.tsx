import Link from "next/link";
import type { CharacterCardDTO } from "@buttercupp/shared";
import { cn } from "@/lib/utils";
import { taglineFrom } from "@/lib/text";

export interface CharacterRelationshipHint {
  affectionLevel: number;
  mood?: string | null;
}

export interface CharacterCardProps {
  character: CharacterCardDTO;
  viewerAllowsMature: boolean;
  relationship?: CharacterRelationshipHint;
  index?: number;
}

// Image-forward persona card. Mature gating (blur + "18+ verify to view"
// overlay) is preserved exactly from the Phase 03 contract; the server is
// still authoritative for what a viewer may see. Hover motion is scoped
// through Tailwind's `motion-safe:` variant so prefers-reduced-motion users
// get a still card.
export function CharacterCard({
  character,
  viewerAllowsMature,
  relationship,
  index = 0,
}: CharacterCardProps) {
  const gated = character.contentRating === "mature" && !viewerAllowsMature;
  const tagline = taglineFrom(character.bio, 90);
  // Stagger cap: only the first 12 cards animate in with a delay to avoid
  // an obviously "waterfall" reveal on load-more.
  const delay = Math.min(index, 12) * 40;
  const dotLabel = relationship?.mood
    ? `Mood: ${relationship.mood}`
    : (relationship?.affectionLevel ?? 0) > 0
    ? "Ongoing relationship"
    : "Available";
  const dotClass =
    (relationship?.affectionLevel ?? 0) > 0 || relationship?.mood ? "bg-rose-400" : "bg-emerald-400";

  return (
    <Link
      href={`/characters/${character.id}`}
      data-testid="character-card"
      className={cn(
        "group relative flex aspect-[9/16] flex-col overflow-hidden rounded-2xl shadow-md ring-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
        "motion-safe:transition motion-safe:duration-300 motion-safe:animate-[buttercupp-card-in_400ms_ease-out_both]",
        "motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-xl",
      )}
      style={{
        animationDelay: `${delay}ms`,
        backgroundColor: "hsl(var(--buttercupp-surface, 210 40% 96%))",
        borderColor: "hsl(var(--buttercupp-border, 214 32% 91%))",
      }}
    >
      {character.avatarUrl ? (
        <img
          src={character.avatarUrl}
          alt={character.name}
          loading={index < 4 ? "eager" : "lazy"}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top",
            "motion-safe:transition-transform motion-safe:duration-500",
            "motion-safe:group-hover:scale-105",
            gated && "scale-110 blur-lg",
          )}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-4xl font-semibold"
          style={{ color: "hsl(var(--buttercupp-muted, 215 16% 47%))" }}
        >
          {character.name[0]?.toUpperCase() ?? "?"}
        </div>
      )}

      {/*
        Scrim: bottom gradient guarantees AA contrast for the name + tagline
        overlay regardless of the image behind it. Do not remove; the text
        below relies on it for legibility.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      <span
        aria-label={dotLabel}
        title={dotLabel}
        className={cn("absolute left-3 top-3 h-2.5 w-2.5 rounded-full shadow ring-2 ring-black/40", dotClass)}
      />
      {gated ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/55 text-center text-white">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium">
            18+ verify to view
          </span>
        </div>
      ) : null}

      <div className="relative z-10 mt-auto flex flex-col gap-1.5 p-4 text-white">
        <h3 className="font-display text-lg font-semibold leading-tight drop-shadow">
          {character.name}
        </h3>
        {tagline ? (
          <p className="line-clamp-1 text-xs text-white/85 drop-shadow-sm">{tagline}</p>
        ) : null}
        {character.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {character.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
