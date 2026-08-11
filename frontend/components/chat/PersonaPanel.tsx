"use client";

// Right column of the chat surface: the persona's image carousel, name +
// description, social handles, and an assets strip (images + reels) with a
// "private content" upsell. Data comes from the character's CharacterMedia.

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Play, Lock } from "lucide-react";

export interface PanelMedia {
  kind: "image" | "video";
  url: string;
}

export interface PersonaPanelProps {
  name: string;
  description: string;
  location?: string | null;
  images: string[];
  assets: PanelMedia[];
}

export function PersonaPanel({ name, description, location, images, assets }: PersonaPanelProps) {
  const [idx, setIdx] = React.useState(0);
  const safeImages = images.length > 0 ? images : [];
  const count = safeImages.length;

  function go(dir: 1 | -1) {
    if (count === 0) return;
    setIdx((i) => ((i + dir) % count + count) % count);
  }

  const shown = assets.slice(0, 3);
  const extra = assets.length - shown.length;

  return (
    <aside
      className="hidden h-full w-96 shrink-0 flex-col overflow-y-auto border-l xl:flex"
      style={{ borderColor: "hsl(var(--buttercupp-border))" }}
    >
      {/* Carousel */}
      <div className="relative m-4 overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "4 / 5" }}>
        {count > 0 ? (
          <img src={safeImages[idx]} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-white/60">
            {name[0]?.toUpperCase()}
          </div>
        )}
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
              {safeImages.map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === idx ? 16 : 6,
                    backgroundColor: i === idx ? "white" : "rgba(255,255,255,0.5)",
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Name + description */}
      <div className="px-5">
        <h2 className="font-display text-2xl font-bold">{name}</h2>
        {location ? (
          <p className="mt-0.5 text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            {location}
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {description}
        </p>

        {/* Socials */}
        <div className="mt-4 flex items-center gap-3">
          <SocialButton label="Instagram">
            <InstagramIcon />
          </SocialButton>
          <SocialButton label="TikTok">
            <TikTokIcon />
          </SocialButton>
        </div>
      </div>

      {/* Assets */}
      {assets.length > 0 ? (
        <div className="mt-5 px-5">
          <div className="grid grid-cols-3 gap-2">
            {shown.map((a, i) => {
              const isLast = i === shown.length - 1 && extra > 0;
              return (
                <div key={a.url} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-black">
                  {a.kind === "video" ? (
                    <>
                      <video src={a.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
                        <Play className="h-3.5 w-3.5 text-white" fill="white" />
                      </span>
                    </>
                  ) : (
                    <img src={a.url} alt="" className="h-full w-full object-cover" />
                  )}
                  {isLast ? (
                    <Link
                      href="/billing"
                      className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-semibold text-white"
                    >
                      +{extra}
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Private content CTA */}
      <div className="p-5">
        <Link
          href="/billing"
          className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-white/5"
          style={{ borderColor: "hsl(var(--buttercupp-border))" }}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose))" }}
          >
            <Lock className="h-4 w-4 text-black" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">My Private Content</span>
            <span className="block text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Exclusive photos &amp; videos
            </span>
          </span>
          <ChevronRight className="h-4 w-4" style={{ color: "hsl(var(--buttercupp-muted))" }} />
        </Link>
      </div>
    </aside>
  );
}

function SocialButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:opacity-80"
      style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
    >
      {children}
    </button>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M16.5 3c.3 2 1.6 3.6 3.5 3.9v2.4c-1.3.1-2.5-.3-3.6-1v5.9c0 3.1-2.5 5.6-5.6 5.6S5.2 20.3 5.2 17.2s2.5-5.6 5.6-5.6c.3 0 .6 0 .9.1v2.5c-.3-.1-.6-.2-.9-.2-1.7 0-3.1 1.4-3.1 3.1s1.4 3.1 3.1 3.1 3.1-1.4 3.1-3.1V3h2.6z" />
    </svg>
  );
}
