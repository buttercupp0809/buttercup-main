"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterCardDTO } from "@poppy/shared";
import { Button } from "@/components/ui/button";
import { PersonaPreviewCard } from "@/components/marketing/PersonaPreviewCard";

const AUTO_ADVANCE_MS = 4500;

export interface HeroProps {
  items: CharacterCardDTO[];
  viewerAllowsMature: boolean;
}

export function Hero({ items, viewerAllowsMature }: HeroProps) {
  // Group items into slides of 3 (desktop). On smaller widths the CSS grid
  // collapses to 1 or 2 per row; the active-slide highlight stays consistent
  // because we always advance by 3.
  const slides = useMemo(() => chunk(items, 3), [items]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const clampSet = useCallback(
    (n: number) => {
      if (slides.length === 0) return;
      const next = ((n % slides.length) + slides.length) % slides.length;
      setActive(next);
    },
    [slides.length],
  );

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => clampSet(active + 1), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [active, paused, clampSet, slides.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      clampSet(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      clampSet(active - 1);
    }
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-sky-50 to-white pb-20 pt-16 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 backdrop-blur dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Unfiltered AI companions. 18+ only.
        </span>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl md:text-6xl dark:text-white">
          Meet the companion you always wanted to talk to.
        </h1>
        <p className="max-w-2xl text-pretty text-base text-slate-600 sm:text-lg dark:text-slate-300">
          Chat, voice, images, and long-term memory. Pick a persona from our roster or create your own in under a minute.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <Button className="px-6 py-6 text-base">Create your companion</Button>
          </Link>
          <Link href="/gallery">
            <Button variant="outline" className="px-6 py-6 text-base">
              Browse
            </Button>
          </Link>
        </div>
      </div>

      <div
        ref={stripRef}
        role="region"
        aria-label="Featured companions"
        aria-roledescription="carousel"
        tabIndex={0}
        onKeyDown={onKey}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="relative mx-auto mt-14 max-w-6xl px-6 focus-visible:outline-none"
      >
        {slides.length > 0 ? (
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-700 ease-out"
              style={{ transform: `translateX(-${active * 100}%)` }}
            >
              {slides.map((slide, i) => (
                <div key={i} className="grid w-full shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {slide.map((c, idx) => (
                    <PersonaPreviewCard
                      key={c.id}
                      character={c}
                      viewerAllowsMature={viewerAllowsMature}
                      priority={i === 0 && idx === 0}
                    />
                  ))}
                </div>
              ))}
            </div>
            {slides.length > 1 ? (
              <div className="mt-6 flex items-center justify-center gap-2" aria-hidden>
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => clampSet(i)}
                    className={
                      i === active
                        ? "h-2 w-6 rounded-full bg-slate-900 dark:bg-white"
                        : "h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-700"
                    }
                    aria-label={`Go to slide ${i + 1}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <SkeletonStrip />
        )}
      </div>
    </section>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function SkeletonStrip() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="aspect-[3/4] w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}
