"use client";

// Reusable upgrade-nudge modal. Used whenever the user hits a limit or clicks
// a paywalled area. Shows a split layout: optional image on the left (blurred
// for locked content, clear for preview lightboxes), upgrade CTA on the right.
//
// All paywall surfaces should use this component instead of bespoke modals.

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { ModalOverlay, ModalCard, ModalCloseButton } from "@/components/ui/Modal";
import { trackCta } from "@/lib/track-cta";

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
    <ModalOverlay
      role="dialog"
      aria-modal
      backdropOpacity={0.85}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <ModalCard size={hasImage ? "lg" : "sm"} className="max-h-[90vh]">
        <ModalCloseButton onClick={onClose} />

        <div className="relative flex flex-col sm:flex-row">
          {/* Left panel: image (optional). Stacks above the CTA on mobile so
              the image never gets squeezed to a sliver. */}
          {hasImage && (
            <div
              className="relative w-full shrink-0 overflow-hidden sm:w-1/2"
              style={{ minHeight: "16rem" }}
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
                    className="flex h-16 w-16 items-center justify-center rounded-full shadow-xl"
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                    }}
                  >
                    <Lock className="h-7 w-7 text-white" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Right panel: upgrade content */}
          <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8 text-center sm:px-8 sm:py-10">
            {/* Lock icon only when there is no image panel */}
            {!hasImage && (
              <div className="mb-2 flex justify-center">
                <div
                  className="relative flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.25), hsl(var(--buttercupp-accent-violet) / 0.25))",
                    border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.4)",
                    boxShadow: "0 8px 24px -6px hsl(var(--buttercupp-accent-rose) / 0.45)",
                  }}
                >
                  <Lock className="h-7 w-7" style={{ color: "hsl(var(--buttercupp-accent-rose))" }} />
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 animate-pulse rounded-2xl"
                    style={{ background: "hsl(var(--buttercupp-accent-rose) / 0.2)", filter: "blur(14px)" }}
                  />
                </div>
              </div>
            )}

            <div>
              <h2 className="font-display text-2xl font-semibold" style={{ color: "hsl(0 0% 98%)" }}>
                {title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
                {description}
              </p>
            </div>

            <Link
              href={ctaHref}
              onClick={() => { trackCta("upgrade_modal_subscribe", "upgrade_modal"); onClose(); }}
              className="flex w-full items-center justify-center rounded-xl py-3.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                boxShadow: "0 10px 24px -6px hsl(var(--buttercupp-accent-rose) / 0.55)",
              }}
            >
              {ctaLabel}
            </Link>

            {footerText && (
              <p className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
                {footerText}
              </p>
            )}
          </div>
        </div>
      </ModalCard>
    </ModalOverlay>
  );
}
