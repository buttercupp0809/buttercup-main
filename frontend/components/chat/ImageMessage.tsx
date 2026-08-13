"use client";

// Inline image bubble. Shows a loading skeleton while generating, then a
// natural-aspect thumbnail. Clicking opens a modal with the full image on
// the left and an upgrade / browse CTA on the right.

import * as React from "react";
import { X, Lock } from "lucide-react";

interface Props {
  mediaAssetId: string;
  url: string | null;
  caption?: string;
  error?: string | null;
}

export function ImageMessage({ mediaAssetId, url, caption, error }: Props) {
  const [open, setOpen] = React.useState(false);

  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
        Image failed ({error}).
      </div>
    );
  }

  if (!url) {
    return (
      <div
        data-media-id={mediaAssetId}
        className="flex w-48 animate-pulse items-center justify-center rounded-lg bg-slate-200 text-xs text-slate-500 dark:bg-slate-800"
        style={{ aspectRatio: "9 / 16", minHeight: "12rem" }}
      >
        Generating image...
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1" data-media-id={mediaAssetId}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 hover:opacity-90 transition-opacity"
          style={{ maxWidth: "200px" }}
          aria-label="View image"
        >
          <img
            src={url}
            alt={caption ?? "generated"}
            loading="lazy"
            className="w-full h-auto block"
            style={{ maxHeight: "320px", objectFit: "cover" }}
          />
        </button>
        {caption ? <span className="text-xs text-slate-500">{caption}</span> : null}
      </div>

      {open ? (
        <ImageModal url={url} caption={caption} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ImageModal({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption?: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal
    >
      <div
        className="relative flex w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl shadow-2xl md:flex-row"
        style={{
          backgroundColor: "hsl(240 14% 9%)",
          border: "1px solid hsl(240 10% 18%)",
          maxHeight: "90vh",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#fff" }}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Left: image */}
        <div className="flex-none md:w-[55%] overflow-hidden">
          <img
            src={url}
            alt={caption ?? "generated"}
            className="h-full w-full object-contain"
            style={{ maxHeight: "90vh" }}
          />
        </div>

        {/* Right: upgrade CTA */}
        <div
          className="flex flex-col justify-center gap-5 p-7 md:w-[45%]"
          style={{ borderLeft: "1px solid hsl(240 10% 18%)" }}
        >
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(135deg, hsl(344 84% 71% / 0.25), hsl(262 72% 68% / 0.25))",
            }}
          >
            <Lock className="h-5 w-5" style={{ color: "hsl(344 84% 71%)" }} />
          </div>

          <div>
            <h2
              className="font-display text-xl font-semibold leading-snug"
              style={{ color: "hsl(0 0% 98%)" }}
            >
              Unlock unlimited images
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(240 6% 65%)" }}>
              Upgrade to Premium for unlimited image generation, exclusive content, and deeper connections with your companions.
            </p>
          </div>

          <a
            href="/billing"
            className="flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{
              background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
            }}
          >
            Upgrade to Premium
          </a>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(240 6% 65%)" }}>
              Or chat for free with:
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="/discover"
                className="flex items-center gap-3 rounded-xl p-3 transition-colors"
                style={{
                  backgroundColor: "hsl(240 12% 13%)",
                  border: "1px solid hsl(240 10% 18%)",
                  color: "hsl(0 0% 98%)",
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "linear-gradient(135deg, hsl(344 84% 71% / 0.3), hsl(262 72% 68% / 0.3))",
                    color: "hsl(344 84% 71%)",
                  }}
                >
                  S
                </div>
                <div>
                  <p className="text-sm font-medium">Explore Free Companions</p>
                  <p className="text-xs" style={{ color: "hsl(240 6% 65%)" }}>Browse all available characters</p>
                </div>
              </a>

              <a
                href="/gallery"
                className="flex items-center gap-3 rounded-xl p-3 transition-colors"
                style={{
                  backgroundColor: "hsl(240 12% 13%)",
                  border: "1px solid hsl(240 10% 18%)",
                  color: "hsl(0 0% 98%)",
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "linear-gradient(135deg, hsl(262 72% 68% / 0.3), hsl(344 84% 71% / 0.3))",
                    color: "hsl(262 72% 68%)",
                  }}
                >
                  G
                </div>
                <div>
                  <p className="text-sm font-medium">Community Gallery</p>
                  <p className="text-xs" style={{ color: "hsl(240 6% 65%)" }}>Discover community-created companions</p>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
