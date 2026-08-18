"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, Play, MapPin, MessageCircle } from "lucide-react";
import type { CharacterCardDTO } from "@buttercupp/shared";
import type { PublicReel } from "@/lib/reels/data";
import { taglineFrom } from "@/lib/text";
import { cn } from "@/lib/utils";

/*
 * The roster, on the landing page, above the fold-and-a-half.
 *
 * A visitor decides whether a companion product is for them by looking at who is
 * on it, so the page shows the roster instead of describing it. Cards are
 * media-first: portrait bleeds to every edge, video takes over on hover for the
 * personas that have a reel, and the only chrome is a tag rail and honest
 * counts. Every tile is a signup entry point.
 */

// Tag rail. Built from the real tags on the roster, so it can never advertise a
// filter that returns nothing.
function tagRail(items: CharacterCardDTO[], max = 14): string[] {
  const counts = new Map<string, number>();
  for (const c of items) {
    for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

export interface CompanionFeedProps {
  items: CharacterCardDTO[];
  reels: PublicReel[];
  viewerAllowsMature: boolean;
}

export function CompanionFeed({ items, reels, viewerAllowsMature }: CompanionFeedProps) {
  const [tag, setTag] = React.useState<string | null>(null);
  const tags = React.useMemo(() => tagRail(items), [items]);

  const reelFor = React.useMemo(() => {
    const m = new Map<string, PublicReel>();
    for (const r of reels) if (!m.has(r.characterId)) m.set(r.characterId, r);
    return m;
  }, [reels]);

  const shown = React.useMemo(
    () => (tag ? items.filter((c) => c.tags.includes(tag)) : items),
    [items, tag],
  );

  return (
    <section className="mx-auto max-w-7xl px-6 px-safe pb-20 pt-14">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-[hsl(var(--bc-cream))] sm:text-[2.5rem]">
          Who is on tonight
        </h2>
        <Link
          href="/gallery"
          className="text-sm font-semibold text-[hsl(var(--bc-honey))] underline-offset-4 hover:underline"
        >
          Browse all {items.length}
        </Link>
      </div>

      {/* Horizontal taxonomy rail, the way every companion platform does it:
          fast to scan, no dropdowns, no apply button. */}
      <div className="-mx-6 mb-6 flex gap-2 overflow-x-auto px-6 pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TagChip label="Everyone" active={tag === null} onClick={() => setTag(null)} />
        {tags.map((t) => (
          <TagChip key={t} label={t} active={tag === t} onClick={() => setTag(t)} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((c, i) => (
          <FeedCard
            key={c.id}
            character={c}
            reel={reelFor.get(c.id)}
            viewerAllowsMature={viewerAllowsMature}
            eager={i < 5}
          />
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-[hsl(var(--bc-muted))]">
          Nobody is tagged {tag} yet. Try another.
        </p>
      ) : null}
    </section>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "bc-press shrink-0 rounded-full px-3.5 py-2 text-[0.8125rem] font-medium capitalize",
        "transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)]",
        active
          ? "bg-[hsl(var(--bc-amber))] text-[hsl(28_45%_9%)] shadow-[0_6px_18px_-8px_hsl(var(--bc-amber)/0.6)]"
          : "bg-[hsl(var(--bc-surface-2)/0.8)] text-[hsl(var(--bc-muted))] hover:text-[hsl(var(--bc-fg))]",
      )}
    >
      {label}
    </button>
  );
}

function FeedCard({
  character,
  reel,
  viewerAllowsMature,
  eager,
}: {
  character: CharacterCardDTO;
  reel?: PublicReel;
  viewerAllowsMature: boolean;
  eager: boolean;
}) {
  const gated = character.contentRating === "mature" && !viewerAllowsMature;
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [warm, setWarm] = React.useState(false);

  // The <video> is only mounted after the first hover. Mounting one per tile up
  // front would mean twenty video elements fetching metadata on load.
  function enter() {
    setWarm(true);
    const v = videoRef.current;
    if (v) v.play().catch(() => {});
  }
  function leave() {
    const v = videoRef.current;
    if (v) v.pause();
  }

  React.useEffect(() => {
    if (!warm) return;
    const v = videoRef.current;
    if (v) v.play().catch(() => {});
  }, [warm]);

  return (
    <Link
      href="/signup"
      onMouseEnter={reel && !gated ? enter : undefined}
      onMouseLeave={reel && !gated ? leave : undefined}
      onFocus={reel && !gated ? enter : undefined}
      onBlur={reel && !gated ? leave : undefined}
      // Keeps the landing-page contract the e2e marketing spec asserts on.
      data-testid="persona-preview"
      className="bc-media bc-media-lift group block aspect-[3/4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
    >
      {character.avatarUrl ? (
        <img
          src={character.avatarUrl}
          alt={character.name}
          loading={eager ? "eager" : "lazy"}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top",
            "transition-transform duration-[600ms] ease-[var(--ease-out)]",
            "motion-safe:group-hover:scale-[1.06]",
            gated && "scale-110 blur-xl",
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[hsl(var(--bc-surface-3))] font-display text-3xl text-[hsl(var(--bc-subtle))]">
          {character.name[0]?.toUpperCase() ?? "?"}
        </div>
      )}

      {reel && !gated && warm ? (
        <video
          ref={videoRef}
          src={reel.src}
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover object-top opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      ) : null}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%]"
        style={{
          background:
            "linear-gradient(to top, hsl(28 32% 3% / 0.95), hsl(28 28% 4% / 0.45) 46%, transparent)",
        }}
      />

      {/* Top rail: video marker and honest like count. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
        {reel && !gated ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(28_30%_4%/0.66)] px-2 py-1 text-[0.6875rem] font-semibold text-[hsl(var(--bc-honey))] backdrop-blur-sm">
            <Play className="h-2.5 w-2.5 fill-current" />
            reel
          </span>
        ) : (
          <span />
        )}
        {reel && reel.likes > 0 ? (
          <span className="tabular inline-flex items-center gap-1 rounded-full bg-[hsl(28_30%_4%/0.66)] px-2 py-1 text-[0.6875rem] font-semibold text-[hsl(var(--bc-cream)/0.9)] backdrop-blur-sm">
            <Heart className="h-2.5 w-2.5 fill-current text-[hsl(var(--bc-amber))]" />
            {compact(reel.likes)}
          </span>
        ) : null}
      </div>

      {gated ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="bc-pill text-[hsl(var(--bc-honey))]">18+ verify to view</span>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate font-display text-[1.0625rem] font-semibold tracking-[-0.02em] text-[hsl(var(--bc-cream))]">
            {character.name}
          </h3>
          {reel?.location ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-[hsl(var(--bc-cream)/0.6)]">
              <MapPin className="h-2.5 w-2.5" />
              {reel.location}
            </span>
          ) : null}
        </div>

        {/* One line on phones: at ~170px wide a two-line bio plus a tag row left
            the name fighting for the same few pixels. */}
        <p className="line-clamp-1 text-xs leading-snug text-[hsl(var(--bc-cream)/0.72)] sm:line-clamp-2 sm:text-[0.8125rem]">
          {taglineFrom(character.bio, 70)}
        </p>

        {/*
          Hover swaps the tag row for the action. Two states in one strip keeps
          the card quiet at rest and unambiguous the moment it is touched.
          Hidden on phones, where hover does not exist and the space is better
          spent on the portrait.
        */}
        <div className="relative mt-0.5 hidden h-6 sm:block">
          <div className="absolute inset-0 flex gap-1 overflow-hidden transition-opacity duration-200 ease-[var(--ease-out)] group-hover:opacity-0 group-focus-visible:opacity-0">
            {character.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="shrink-0 rounded-full border border-[hsl(var(--bc-cream)/0.14)] bg-[hsl(var(--bc-cream)/0.08)] px-2 py-0.5 text-[0.625rem] font-medium capitalize text-[hsl(var(--bc-cream)/0.85)]"
              >
                {t}
              </span>
            ))}
          </div>
          <span className="absolute inset-0 flex translate-y-1 items-center gap-1.5 text-[0.8125rem] font-semibold text-[hsl(var(--bc-honey))] opacity-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:translate-y-0">
            <MessageCircle className="h-3.5 w-3.5" />
            Message {character.name}
          </span>
        </div>
      </div>
    </Link>
  );
}
