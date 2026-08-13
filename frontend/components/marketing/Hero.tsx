"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterCardDTO } from "@buttercupp/shared";
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
    <section className="relative overflow-hidden pb-20 pt-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 text-center">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-6xl">
          Meet the{" "}
          <span
            style={{
              background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            companion
          </span>{" "}
          you always wanted to talk to.
        </h1>
        <p
          className="max-w-2xl text-pretty text-base sm:text-lg"
          style={{ color: "hsl(240 6% 65%)" }}
        >
          Chat, voice, images, and long-term memory. Pick a persona from our roster or create your own in under a minute.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <button
              className="rounded-lg px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
              style={{
                background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
              }}
            >
              Create your companion
            </button>
          </Link>
          <Link href="/gallery">
            <button
              className="rounded-lg px-6 py-3 text-base font-semibold transition hover:opacity-80"
              style={{
                border: "1px solid hsl(344 84% 71% / 0.5)",
                color: "hsl(344 84% 71%)",
                background: "transparent",
              }}
            >
              Browse
            </button>
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
                    style={
                      i === active
                        ? {
                          background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                        }
                        : {
                          background: "transparent",
                          border: "1px solid hsl(240 10% 18%)",
                        }
                    }
                    className={i === active ? "h-2 w-6 rounded-full" : "h-2 w-2 rounded-full"}
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
          className="aspect-[3/4] w-full animate-pulse rounded-2xl"
          style={{ backgroundColor: "hsl(240 12% 13%)" }}
        />
      ))}
    </div>
  );
}
