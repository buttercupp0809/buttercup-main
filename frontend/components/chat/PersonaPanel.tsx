"use client";

// Right column of the chat surface: the persona's primary image, name,
// description, and a gallery grid of remaining images/reels.
// Images are generated at 9:16 and displayed with object-top so faces are
// never cropped. Gallery items at index 0 can be previewed (lightbox);
// index 1+ are paywalled with a blurred upgrade modal.

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Play, Lock } from "lucide-react";
import { UpgradeModal } from "@/components/ui/UpgradeModal";

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
  const primaryImage = images[0] ?? null;
  const galleryImages = images.slice(1);
  const galleryItems: PanelMedia[] = [
    ...galleryImages.map((url) => ({ kind: "image" as const, url })),
    ...assets,
  ];

  // freeItem: clicked free tile -> preview lightbox (clear image + upgrade nudge)
  const [freeItem, setFreeItem] = React.useState<PanelMedia | null>(null);
  // lockedItem: clicked locked tile -> blurred upgrade modal
  const [lockedItem, setLockedItem] = React.useState<PanelMedia | null>(null);

  return (
    <>
      <aside
        className="hidden h-full w-96 shrink-0 flex-col overflow-y-auto border-l xl:flex"
        style={{ borderColor: "hsl(var(--buttercupp-border))" }}
      >
        {/* Primary image — 4:5 portrait, object-top keeps the face visible */}
        <div className="relative m-4 overflow-hidden rounded-2xl bg-black" style={{ paddingBottom: "125%" }}>
          {primaryImage ? (
            <img src={primaryImage} alt={name} className="absolute inset-0 h-full w-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-white/60">
              {name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + description */}
        <div className="px-5 pt-2">
          <h2 className="font-display text-2xl font-bold">{name}</h2>
          {location ? (
            <p className="mt-0.5 text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              {location}
            </p>
          ) : null}
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            {description}
          </p>
        </div>

        {/* Gallery grid — 9:16 tiles, object-top. First tile free (preview), rest locked. */}
        {galleryItems.length > 0 ? (
          <div className="mt-5 px-4">
            <div className="grid grid-cols-3 gap-2">
              {galleryItems.map((item, i) => {
                const isLocked = i >= 1;
                return (
                  <div
                    key={item.url + i}
                    className="relative overflow-hidden rounded-lg bg-black"
                    style={{ aspectRatio: "9 / 16" }}
                  >
                    {item.kind === "video" ? (
                      <>
                        <video
                          src={item.url}
                          muted
                          playsInline
                          preload="metadata"
                          className={`h-full w-full object-cover object-top${isLocked ? " blur-sm scale-105" : ""}`}
                        />
                        {!isLocked && (
                          <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
                            <Play className="h-3.5 w-3.5 text-white" fill="white" />
                          </span>
                        )}
                      </>
                    ) : (
                      <img
                        src={item.url}
                        alt=""
                        className={`h-full w-full object-cover object-top${isLocked ? " blur-sm scale-105" : ""}`}
                      />
                    )}

                    {/* Free tile: clickable overlay -> preview lightbox */}
                    {!isLocked && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setFreeItem(item)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFreeItem(item); }}
                        aria-label="Preview photo"
                        className="absolute inset-0 cursor-pointer"
                      />
                    )}

                    {/* Locked tile: blurred overlay + lock icon -> upgrade modal */}
                    {isLocked && (
                      <button
                        type="button"
                        onClick={() => setLockedItem(item)}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/30"
                        aria-label="Unlock premium content"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                          <Lock className="h-4 w-4 text-white" />
                        </span>
                      </button>
                    )}
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

      {/* Free-tile lightbox: full clear image + upgrade nudge */}
      {freeItem && (
        <UpgradeModal
          imageSrc={freeItem.url}
          imageAlt={name}
          imageBlurred={false}
          title={`Unlock ${name}'s Private Gallery`}
          description="Get unlimited access to exclusive photos, videos, and intimate moments. Upgrade to Premium and see everything."
          onClose={() => setFreeItem(null)}
        />
      )}

      {/* Locked-tile modal: blurred image + upgrade nudge */}
      {lockedItem && (
        <UpgradeModal
          imageSrc={lockedItem.url}
          imageAlt={name}
          imageBlurred
          title={`Unlock ${name}'s Private Gallery`}
          description="Get unlimited access to exclusive photos, videos, and intimate moments. Upgrade to Premium and see everything."
          onClose={() => setLockedItem(null)}
        />
      )}
    </>
  );
}
