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
      className={cn(
        "group relative flex aspect-[3/4] w-full flex-col overflow-hidden",
        "rounded-[var(--bc-radius-lg)] bg-[hsl(var(--bc-surface-2))]",
        "shadow-[var(--bc-shadow-lg)] ring-1 ring-[hsl(var(--bc-cream)/0.08)]",
        "transition-[transform,box-shadow,ring-color] duration-300 ease-[var(--ease-out)]",
        "hover:ring-[hsl(var(--bc-amber)/0.35)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]",
        "motion-safe:hover:-translate-y-1",
      )}
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
        <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--bc-surface-3))] font-display text-4xl font-semibold text-[hsl(var(--bc-subtle))]">
          {character.name[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      {/* Warm scrim, not neutral black: keeps the amber brand temperature. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/3"
        style={{
          background:
            "linear-gradient(to top, hsl(28 30% 4% / 0.92), hsl(28 24% 5% / 0.4) 45%, transparent)",
        }}
      />
      <span
        aria-hidden
        className="bc-pulse-ring absolute right-3 top-3 h-2 w-2 rounded-full bg-[hsl(var(--bc-success))]"
      />
      {gated ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[hsl(28_24%_4%/0.62)] text-center">
          <span className="bc-pill text-[hsl(var(--bc-honey))]">18+ verify to view</span>
        </div>
      ) : null}
      <div className="relative z-10 mt-auto flex flex-col gap-1 p-4">
        <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-[hsl(var(--bc-cream))]">
          {character.name}
        </h3>
        {tagline ? (
          <p className="line-clamp-2 text-pretty text-sm text-[hsl(var(--bc-cream)/0.78)]">
            {tagline}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
