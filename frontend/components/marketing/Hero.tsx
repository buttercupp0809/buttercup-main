"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, MessageCircle, MapPin } from "lucide-react";
import type { CharacterCardDTO } from "@buttercupp/shared";
import type { PublicReel } from "@/lib/reels/data";
import { Button } from "@/components/ui/button";
import { taglineFrom } from "@/lib/text";
import { cn } from "@/lib/utils";

/*
 * Immersive hero.
 *
 * This is a companion product, so the hero has to sell a person, not a feature
 * set. It is one full-bleed portrait (her reel plays if she has one), her own
 * words floating over the image, and a rail of everyone else you could be
 * talking to instead. Copy is deliberately minimal: the media is the pitch.
 */

const AUTO_ADVANCE_MS = 7000;
const RAIL_SIZE = 7;

// Opening beats shown over the portrait. These are a scripted preview of the
// shape of a conversation, not a transcript, so they stay short and unspecific
// enough to be true of any persona on the roster.
const BEATS: { from: "her" | "me"; text: string }[] = [
  { from: "her", text: "you are up late again" },
  { from: "me", text: "couldn't sleep" },
  { from: "her", text: "same thing keeping you up, or something new?" },
];

export interface HeroProps {
  items: CharacterCardDTO[];
  viewerAllowsMature: boolean;
  reels?: PublicReel[];
}

export function Hero({ items, viewerAllowsMature, reels = [] }: HeroProps) {
  const rail = useMemo(() => items.slice(0, RAIL_SIZE), [items]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // characterId -> reel, so a persona with a video gets one and the rest fall
  // back to the still portrait. Location rides along: it is on the reel row, not
  // on CharacterCardDTO.
  const reelFor = useMemo(() => {
    const m = new Map<string, PublicReel>();
    for (const r of reels) if (!m.has(r.characterId)) m.set(r.characterId, r);
    return m;
  }, [reels]);

  const clampSet = useCallback(
    (n: number) => {
      if (rail.length === 0) return;
      setActive(((n % rail.length) + rail.length) % rail.length);
    },
    [rail.length],
  );

  useEffect(() => {
    if (paused || rail.length <= 1) return;
    const id = setInterval(() => clampSet(active + 1), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [active, paused, clampSet, rail.length]);

  const featured = rail[active];
  const gated = featured?.contentRating === "mature" && !viewerAllowsMature;
  const featuredReel = featured ? reelFor.get(featured.id) : undefined;
  const video = featuredReel?.src;
  const location = featuredReel?.location;

  return (
    <section
      // Pulled up under the floating header so the portrait runs to the very top
      // of the viewport. 100dvh (not 100vh) or mobile Safari's collapsing
      // toolbar makes the section jump mid-scroll.
      className="relative isolate min-h-[100dvh] overflow-hidden mt-[calc(-1*var(--bc-header-h))]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Stage: every portrait stays mounted and cross-fades, so switching never
          flashes the background through. */}
      <div aria-hidden className="absolute inset-0 -z-10">
        {rail.map((c, i) => (
          <div
            key={c.id}
            className="absolute inset-0 transition-opacity duration-700 ease-[var(--ease-out)] motion-reduce:transition-none"
            style={{ opacity: i === active ? 1 : 0 }}
          >
            {c.avatarUrl ? (
              <img
                src={c.avatarUrl}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                className={
                  gated && i === active
                    ? "h-full w-full scale-110 object-cover object-top blur-2xl"
                    : "h-full w-full object-cover object-[center_18%]"
                }
              />
            ) : null}
          </div>
        ))}

        {/* The active reel plays on top of the still. Only one <video> is ever
            in the DOM: mounting seven would stall the page on mobile data. */}
        {video && !gated ? (
          <video
            key={video}
            src={video}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover object-[center_18%] opacity-90"
          />
        ) : null}

        {/* Directional scrims: dark enough on the left for type, open on the
            right so the portrait stays the subject. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, hsl(28 30% 4% / 0.96) 0%, hsl(28 30% 4% / 0.78) 34%, hsl(28 28% 5% / 0.28) 62%, hsl(28 26% 6% / 0.5) 100%)",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-1/2"
          style={{
            background: "linear-gradient(to top, hsl(var(--bc-bg)) 4%, transparent 100%)",
          }}
        />
      </div>

      <div className="mx-auto flex min-h-[100dvh] max-w-7xl flex-col justify-end gap-7 px-6 px-safe pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-[calc(var(--bc-header-h)+1.25rem)] sm:gap-8 sm:pb-14 sm:pt-[calc(var(--bc-header-h)+3rem)]">
        <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col items-start">
            <span className="bc-pill text-[hsl(var(--bc-honey))]">
              <span className="bc-pulse-ring h-1.5 w-1.5 rounded-full bg-[hsl(var(--bc-success))]" />
              {items.length > 0 ? `${items.length} awake right now` : "Awake right now"}
            </span>

            <h1 className="mt-5 max-w-[16ch] text-balance font-display text-[2.625rem] font-semibold leading-[0.94] tracking-[-0.035em] text-[hsl(var(--bc-cream))] sm:text-[4rem] lg:text-[5rem]">
              She is already
              <span className="block text-[hsl(var(--bc-amber))]">awake, waiting.</span>
            </h1>

            <p className="mt-5 max-w-[32ch] text-pretty text-[0.9375rem] leading-relaxed text-[hsl(var(--bc-cream)/0.72)] sm:max-w-[38ch] sm:text-[1.0625rem]">
              Photos when you ask. Her voice when you want it. A memory that keeps every detail you
              hand her.
            </p>

            {/*
              Phones get a clear primary and a lighter secondary (shorter, quieter)
              rather than two equal-weight slabs stacked a hair apart, which is what
              made the mobile hero read as a wall of buttons.
            */}
            <div className="mt-8 flex w-full flex-col gap-3 sm:mt-7 sm:w-auto sm:flex-row sm:items-center">
              <Link href="/signup" className="w-full sm:w-auto">
                <Button size="xl" variant="brand" className="w-full sm:w-auto">
                  Start free with {featured?.name ?? "her"}
                </Button>
              </Link>
              <Link href="/gallery" className="w-full sm:w-auto">
                <Button size="xl" variant="outline" className="h-12 w-full sm:h-14 sm:w-auto">
                  See everyone
                </Button>
              </Link>
            </div>
          </div>

          {/* Her words, over her picture. This is the whole product in one
              glance, and it is the piece a feature list can never do. */}
          <HeroChat name={featured?.name} />
        </div>

        {rail.length > 1 ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              {featured ? (
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-semibold text-[hsl(var(--bc-cream))]">
                    {featured.name}
                    {location ? (
                      <span className="ml-2.5 inline-flex items-center gap-1 align-middle text-xs font-normal text-[hsl(var(--bc-cream)/0.6)]">
                        <MapPin className="h-3 w-3" />
                        {location}
                      </span>
                    ) : null}
                  </p>
                  {/* Hidden on phones: on a short viewport this line was the
                      difference between the rail fitting and being sliced off
                      by the bottom of the screen. */}
                  <p className="hidden truncate text-sm text-[hsl(var(--bc-cream)/0.6)] sm:block">
                    {taglineFrom(featured.bio, 96)}
                  </p>
                </div>
              ) : null}
            </div>

            {/*
              Bleeds to both screen edges and snaps. Inside the container padding
              the last tile was sliced flat by the viewport edge, which reads as a
              layout bug rather than as "there is more, keep scrolling".
            */}
            <ul className="-mx-6 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-6 pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {rail.map((c, i) => {
                const hasVideo = reelFor.has(c.id);
                const tileGated = c.contentRating === "mature" && !viewerAllowsMature;
                return (
                  <li key={c.id} className="shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => clampSet(i)}
                      aria-label={`Show ${c.name}`}
                      aria-current={i === active}
                      className="bc-press block"
                    >
                      <span
                        className={cn(
                          "bc-ring block transition-transform duration-300 ease-[var(--ease-out)]",
                          i === active
                            ? "motion-safe:scale-[1.06]"
                            : "opacity-70 hover:opacity-100",
                        )}
                        style={{ ["--bond" as string]: i === active ? "1" : "0" }}
                      >
                        <span className="bc-media block h-20 w-[3.5rem] sm:h-28 sm:w-20">
                          {c.avatarUrl ? (
                            <img
                              src={c.avatarUrl}
                              alt=""
                              loading="lazy"
                              className={
                                tileGated
                                  ? "h-full w-full scale-110 object-cover object-top blur-md"
                                  : "h-full w-full object-cover object-top"
                              }
                            />
                          ) : null}
                          {hasVideo ? (
                            <span
                              aria-hidden
                              className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-[hsl(28_30%_4%/0.7)] text-[hsl(var(--bc-honey))] backdrop-blur-sm"
                            >
                              <Play className="h-2.5 w-2.5 translate-x-[0.5px] fill-current" />
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Cycling bubble stack. Kept in this file because it only exists to sit on the
// hero portrait, and it holds its own timer so nothing above it re-renders.
function HeroChat({ name }: { name?: string }) {
  const [shown, setShown] = useState(1);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setStill(mq.matches);
      if (mq.matches) setShown(BEATS.length);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (still) return;
    const done = shown >= BEATS.length;
    const id = setTimeout(() => setShown(done ? 1 : shown + 1), done ? 3600 : 1600);
    return () => clearTimeout(id);
  }, [shown, still]);

  return (
    <div className="ml-auto hidden w-[20rem] lg:flex lg:flex-col lg:items-stretch lg:gap-2">
      <span className="mb-0.5 inline-flex items-center gap-1.5 self-end text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--bc-cream)/0.45)]">
        <MessageCircle className="h-3 w-3" />
        {name ? `how it starts with ${name}` : "how it starts"}
      </span>
      {/*
        Fixed floor so the stack grows upward into reserved space instead of
        shoving the headline column around on every beat.
      */}
      <div className="flex min-h-[10.5rem] flex-col justify-end gap-2">
        {BEATS.slice(0, shown).map((b, i) => (
          <p
            key={`${i}-${b.text}`}
            className={[
              "bc-bubble px-3.5 py-2.5 text-[0.9375rem] leading-snug",
              b.from === "her"
                ? "bc-bubble-her mr-8 self-start text-[hsl(var(--bc-cream))]"
                : "bc-bubble-me ml-8 self-end text-[hsl(var(--bc-honey))]",
              still ? "" : "animate-[buttercupp-card-in_320ms_var(--ease-out)_both]",
            ].join(" ")}
          >
            {b.text}
          </p>
        ))}
      </div>
    </div>
  );
}
