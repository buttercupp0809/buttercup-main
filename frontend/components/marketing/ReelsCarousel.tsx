"use client";

// Landing-page reels carousel: a horizontal, snap-scrolling row of 9:16 reel
// previews. Each preview autoplays muted only while it is on screen (keeps the
// page light), shows the persona name + location, and links to signup. Left/
// right buttons scroll the row on desktop; touch/trackpad scroll works too.

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PublicReel } from "@/lib/reels/data";

export function ReelsCarousel({ reels }: { reels: PublicReel[] }) {
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  if (reels.length === 0) return null;

  function scrollBy(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 640), behavior: "smooth" });
  }

  return (
    <section className="relative mx-auto max-w-6xl px-6 py-20">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-[hsl(var(--bc-cream))] sm:text-4xl">
            See them in motion
          </h2>
          <p className="mt-2 max-w-xl text-[hsl(var(--bc-muted))]">
            Scroll the reels. Every companion is 18+ and ready to chat.
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <ScrollButton dir={-1} onScroll={scrollBy} />
          <ScrollButton dir={1} onScroll={scrollBy} />
        </div>
      </div>

      <div
        ref={scrollerRef}
        // --bc-gutter:0 opts this rail out of the .px-safe gutter floor: the
        // parent section already applies it, and doubling up would indent the
        // reels away from the heading above them.
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-safe pb-4 [--bc-gutter:0px] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reels.map((reel) => (
          <ReelCard key={reel.id} reel={reel} />
        ))}
      </div>
    </section>
  );
}

function ScrollButton({
  dir,
  onScroll,
}: {
  dir: 1 | -1;
  onScroll: (dir: 1 | -1) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onScroll(dir)}
      aria-label={dir === -1 ? "Scroll left" : "Scroll right"}
      className="bc-press bc-glass flex h-10 w-10 items-center justify-center rounded-full text-[hsl(var(--bc-fg))] transition-[background-color,border-color,color] duration-200 ease-[var(--ease-out)] hover:border-[hsl(var(--bc-amber)/0.45)] hover:text-[hsl(var(--bc-honey))]"
    >
      {dir === -1 ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );
}

function ReelCard({ reel }: { reel: PublicReel }) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <Link
      href="/signup"
      className="bc-media bc-media-lift group block aspect-[9/16] w-44 shrink-0 snap-start sm:w-52"
    >
      <video
        ref={ref}
        src={reel.src}
        muted
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3 text-white">
        {reel.avatar ? (
          <img src={reel.avatar} alt={reel.name} className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white/70" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/70 text-xs font-bold text-white">
            {reel.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold drop-shadow">{reel.name}</div>
          {reel.location ? (
            <div className="truncate text-[11px] text-white/80 drop-shadow-sm">{reel.location}</div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
