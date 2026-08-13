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

// Internal gallery item carries an optional pre-blurred data URI used to
// render locked tiles without exposing the real URL.
interface GalleryItem extends PanelMedia {
  blur?: string;
}

export interface PersonaPanelProps {
  name: string;
  description: string;
  location?: string | null;
  images: string[];
  // Pre-blurred data URIs aligned by index with `images`. Used for locked
  // tiles so the real S3 URL never reaches the DOM.
  imageBlurs?: string[];
  assets: PanelMedia[];
}

export function PersonaPanel({ name, description, location, images, imageBlurs = [], assets }: PersonaPanelProps) {
  const primaryImage = images[0] ?? null;
  const galleryImages = images.slice(1);
  const galleryImageBlurs = imageBlurs.slice(1);
  const galleryItems: GalleryItem[] = [
    ...galleryImages.map((url, idx) => ({ kind: "image" as const, url, blur: galleryImageBlurs[idx] })),
    ...assets.map((a) => ({ ...a })),
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
        {/* Primary image, 4:5 portrait, object-top keeps the face visible */}
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

        {/* Gallery grid: 9:16 tiles, object-top. First tile free (preview), rest locked. */}
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
                    {isLocked ? (
                      /* Locked tile: renders a tiny pre-blurred data URI (worthless
                         bytes). The real URL/key never reaches the DOM. */
                      <button
                        type="button"
                        onClick={() => setLockedItem(item)}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                        aria-label="Unlock premium content"
                      >
                        {item.blur ? (
                          <img
                            src={item.blur}
                            alt=""
                            aria-hidden
                            draggable={false}
                            className="absolute inset-0 h-full w-full scale-110 object-cover object-top"
                          />
                        ) : (
                          <span
                            className="absolute inset-0"
                            style={{
                              background: "linear-gradient(135deg, hsl(var(--buttercupp-surface-2)) 0%, hsl(var(--buttercupp-surface)) 100%)",
                            }}
                          />
                        )}
                        <span className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
                        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/60">
                          <Lock className="h-4 w-4 text-white" />
                        </span>
                      </button>
                    ) : item.kind === "video" ? (
                      /* Free video tile */
                      <>
                        <video
                          src={item.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover object-top"
                        />
                        <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
                          <Play className="h-3.5 w-3.5 text-white" fill="white" />
                        </span>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setFreeItem(item)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFreeItem(item); }}
                          aria-label="Preview video"
                          className="absolute inset-0 cursor-pointer"
                        />
                      </>
                    ) : (
                      /* Free image tile */
                      <>
                        <img src={item.url} alt="" className="h-full w-full object-cover object-top" />
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setFreeItem(item)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFreeItem(item); }}
                          aria-label="Preview photo"
                          className="absolute inset-0 cursor-pointer"
                        />
                      </>
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

      {/* Locked-tile modal: no image passed, real URL must never appear in DOM */}
      {lockedItem && (
        <UpgradeModal
          title={`Unlock ${name}'s Private Gallery`}
          description="Get unlimited access to exclusive photos, videos, and intimate moments. Upgrade to Premium and see everything."
          onClose={() => setLockedItem(null)}
        />
      )}
    </>
  );
}
