import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
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
  /** Grid placement only (span classes). Never used for visual styling. */
  className?: string;
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
  className,
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
  const engaged = (relationship?.affectionLevel ?? 0) > 0 || Boolean(relationship?.mood);

  return (
    <Link
      href={`/characters/${character.id}`}
      data-testid="character-card"
      className={cn(
        // bc-media / bc-media-lift carry the shared frame (top lip, warm
        // diffusion shadow, amber hover edge). Cards must not restate their own
        // ring + shadow stack or discover and the landing feed drift apart.
        "bc-media bc-media-lift group flex aspect-[9/16] flex-col",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]",
        "motion-safe:animate-[buttercupp-card-in_400ms_ease-out_both]",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
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
        <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--bc-surface-3))] font-display text-4xl font-semibold text-[hsl(var(--bc-subtle))]">
          {character.name[0]?.toUpperCase() ?? "?"}
        </div>
      )}

      {/*
        Scrim: bottom gradient guarantees AA contrast for the name + tagline
        overlay regardless of the image behind it. Do not remove; the text
        below relies on it for legibility. Warm-tinted rather than neutral black
        so the grid keeps the brand temperature.
      */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%]"
        style={{
          background:
            "linear-gradient(to top, hsl(28 30% 4% / 0.94), hsl(28 26% 5% / 0.5) 42%, transparent)",
        }}
      />

      <span
        aria-label={dotLabel}
        title={dotLabel}
        className={cn(
          "absolute right-3 top-3 h-2 w-2 rounded-full",
          engaged
            ? "bg-[hsl(var(--bc-amber))] shadow-[0_0_0_3px_hsl(var(--bc-amber)/0.18)]"
            : "bc-pulse-ring bg-[hsl(var(--bc-success))]",
        )}
      />
      {gated ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[hsl(28_24%_4%/0.6)] text-center">
          <span className="bc-pill text-[hsl(var(--bc-honey))]">18+ verify to view</span>
        </div>
      ) : null}

      <div className="relative z-10 mt-auto flex flex-col gap-1.5 p-4">
        <h3 className="font-display text-lg font-semibold leading-tight text-[hsl(var(--bc-cream))]">
          {character.name}
        </h3>
        {tagline ? (
          <p className="line-clamp-1 text-xs text-[hsl(var(--bc-cream)/0.76)]">{tagline}</p>
        ) : null}
        {character.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {character.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-full border border-[hsl(var(--bc-cream)/0.14)] bg-[hsl(var(--bc-cream)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--bc-cream)/0.88)] backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {/*
          Intent affordance. The whole card is the link, but until hover there is
          nothing that says what happens next, which is the single biggest reason
          browse-to-chat conversion leaks on a grid like this.
        */}
        <span
          aria-hidden
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--bc-honey))]",
            "opacity-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]",
            "translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
            "motion-reduce:translate-y-0 motion-reduce:transition-none",
          )}
        >
          Say hi
          <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
