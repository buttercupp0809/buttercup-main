"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { UpgradeModal } from "@/components/ui/UpgradeModal";

interface Props {
  images: string[];
  // Pre-blurred, downscaled data URIs aligned by index with `images`. Locked
  // tiles render these instead of the real image so no real URL/key ever
  // reaches the DOM. Index 0 (the free tile) does not use its blur.
  blurs: string[];
  characterName: string;
}

export function GalleryPaywall({ images, blurs, characterName }: Props) {
  const [lightboxSrc, setLightboxSrc] = React.useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);

  if (images.length === 0) return null;

  return (
    <>
      {/* Horizontal scrollable strip. w-full + overflow-x-auto contains images
          within the column width. px-0.5/py-1 prevent border clipping. */}
      <div className="w-full overflow-x-auto">
        <div className="flex gap-3 px-0.5 py-1" style={{ width: "max-content" }}>
          {images.map((src, i) => {
            const isFree = i === 0;
            return (
              <div
                key={i}
                className="relative w-28 flex-none overflow-hidden rounded-2xl"
                style={{
                  aspectRatio: "9 / 16",
                  border: "1px solid hsl(var(--buttercupp-border))",
                }}
              >
                {isFree ? (
                  /* Free tile: real image is safe to show */
                  <>
                    <img
                      src={src}
                      alt={`${characterName} photo ${i + 1}`}
                      className="absolute inset-0 h-full w-full object-cover object-top"
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxSrc(src)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setLightboxSrc(src); }}
                      aria-label="View photo"
                      className="absolute inset-0 cursor-pointer"
                    />
                  </>
                ) : (
                  /* Locked tile: shows a tiny pre-blurred data URI (worthless
                     bytes). The real URL/key never reaches the DOM. */
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    aria-label="Unlock premium photo"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                  >
                    <img
                      src={blurs[i] ?? ""}
                      alt=""
                      aria-hidden
                      draggable={false}
                      className="absolute inset-0 h-full w-full scale-110 object-cover object-top"
                    />
                    {/* Darkening scrim over the blur for contrast */}
                    <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
                    <div
                      className="relative flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                    >
                      <Lock className="h-4 w-4 text-white" />
                    </div>
                    <span
                      className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
                      style={{
                        background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                      }}
                    >
                      Premium
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Free-image lightbox: shows clear image on left, upgrade nudge on right */}
      {lightboxSrc && (
        <UpgradeModal
          imageSrc={lightboxSrc}
          imageAlt={characterName}
          imageBlurred={false}
          title={`Unlock ${characterName}’s Gallery`}
          description="Premium members get unlimited access to exclusive photos and intimate content."
          onClose={() => setLightboxSrc(null)}
        />
      )}

      {/* Locked-image modal: blurred image on left, same upgrade nudge */}
      {upgradeOpen && (
        <UpgradeModal
          title={`Unlock ${characterName}’s Gallery`}
          description="Premium members get unlimited access to exclusive photos and intimate content."
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </>
  );
}
