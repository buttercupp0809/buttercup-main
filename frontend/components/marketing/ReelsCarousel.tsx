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
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">See them in motion</h2>
          <p className="mt-2 max-w-xl text-slate-600 dark:text-slate-400">
            Scroll the reels. Every companion is 18+ and ready to chat.
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white/70 text-slate-700 backdrop-blur transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white/70 text-slate-700 backdrop-blur transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reels.map((reel) => (
          <ReelCard key={reel.id} reel={reel} />
        ))}
      </div>
    </section>
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
      className="group relative aspect-[9/16] w-44 shrink-0 snap-start overflow-hidden rounded-2xl bg-black shadow-md ring-1 ring-slate-200 transition hover:-translate-y-1 hover:shadow-xl sm:w-52 dark:ring-slate-700"
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
        <img src={reel.avatar} alt={reel.name} className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white/70" />
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
