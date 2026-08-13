"use client";

// Reusable upgrade-nudge modal. Used whenever the user hits a limit or clicks
// a paywalled area. Shows a split layout: optional image on the left (blurred
// for locked content, clear for preview lightboxes), upgrade CTA on the right.
//
// All paywall surfaces should use this component instead of bespoke modals.

import * as React from "react";
import Link from "next/link";
import { Lock, X } from "lucide-react";

export interface UpgradeModalProps {
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerText?: string;
  onClose: () => void;
  // Optional left panel image. When absent the modal is narrow (no split layout).
  imageSrc?: string | null;
  imageAlt?: string;
  // true = blurred with centered lock (for locked content); false = clear (for preview lightbox).
  imageBlurred?: boolean;
}

export function UpgradeModal({
  title,
  description = "Premium members get unlimited access to exclusive photos and intimate content.",
  ctaLabel = "Upgrade to Premium",
  ctaHref = "/billing",
  footerText = "Cancel anytime. No hidden fees.",
  onClose,
  imageSrc,
  imageAlt,
  imageBlurred = false,
}: UpgradeModalProps) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasImage = Boolean(imageSrc);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal
    >
      <div
        className="relative flex w-full overflow-hidden rounded-3xl shadow-2xl"
        style={{
          maxWidth: hasImage ? "48rem" : "24rem",
          border: "1px solid hsl(var(--buttercupp-border))",
          backgroundColor: "hsl(240 14% 9%)",
          maxHeight: "90vh",
        }}
      >
        {/* Left panel: image (optional) */}
        {hasImage && (
          <div
            className="relative w-1/2 shrink-0 overflow-hidden"
            style={{ minHeight: "20rem" }}
          >
            <img
              src={imageSrc!}
              alt={imageAlt ?? title}
              className={`h-full w-full object-cover object-top${imageBlurred ? " scale-110 blur-md" : ""}`}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
            {!imageBlurred && imageAlt && (
              <p className="absolute inset-x-4 bottom-4 font-display text-xl font-bold text-white drop-shadow-lg">
                {imageAlt}
              </p>
            )}
            {imageBlurred && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  <Lock className="h-7 w-7 text-black" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right panel: upgrade content */}
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-10 text-center">
          {/* Lock icon only when there is no image panel */}
          {!hasImage && (
            <div className="mb-2 flex justify-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.2), hsl(var(--buttercupp-accent-violet) / 0.2))",
                  border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.3)",
                }}
              >
                <Lock className="h-7 w-7" style={{ color: "hsl(var(--buttercupp-accent-rose))" }} />
              </div>
            </div>
          )}

          <div>
            <h2 className="font-display text-2xl font-semibold" style={{ color: "hsl(0 0% 98%)" }}>
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(240 6% 65%)" }}>
              {description}
            </p>
          </div>

          <Link
            href={ctaHref}
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-xl py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
            }}
          >
            {ctaLabel}
          </Link>

          {footerText && (
            <p className="text-xs" style={{ color: "hsl(240 6% 50%)" }}>
              {footerText}
            </p>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "hsl(240 6% 65%)" }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
