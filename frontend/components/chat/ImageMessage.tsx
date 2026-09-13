"use client";

// Inline image bubble for chat-generated images.
//
// Shows a loading skeleton while generating, then a thumbnail. Clicking opens
// a modal whose content depends on the viewer's plan:
//
//   Paid (isPremium=true):  image-only lightbox -- the photo inside a rounded
//     ModalCard, nothing else. No text, no CTA, no upgrade nudge.
//
//   Free (isPremium=false): UpgradeModal -- the generated photo fills the
//     hero background and the upgrade/subscribe section overlays at the
//     bottom, matching the same visual pattern used in the gallery paywall.

import * as React from "react";
import { ModalOverlay, ModalCard, ModalCloseButton } from "@/components/ui/Modal";
import { UpgradeModal } from "@/components/ui/UpgradeModal";

interface Props {
  mediaAssetId: string;
  url: string | null;
  caption?: string;
  error?: string | null;
  /** True when the viewer holds an active paid subscription. */
  isPremium?: boolean;
  /** Character name forwarded to the upgrade modal title and alt text. */
  characterName?: string;
  /** When true the image is locked: render the blurUri + CTA overlay instead of the real image. */
  locked?: boolean;
  /** Server-computed blurred inline data URI for locked teasers. */
  blurUri?: string;
  /** Character-voiced CTA copy for locked teasers. */
  ctaText?: string;
}

export function ImageMessage({ mediaAssetId, url, caption, error, isPremium = false, characterName, locked = false, blurUri, ctaText }: Props) {
  const [open, setOpen] = React.useState(false);
  // Tracks a load failure so a broken/expired signed URL renders as a
  // retryable placeholder instead of the browser's default broken-image
  // glyph. `retryKey` forces the <img> to re-request the URL when the user
  // taps retry (a fresh signature is more likely for the second attempt).
  // See Plans/cursor-prompt/35-major-fixes-batch.md #E.
  const [broken, setBroken] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);

  if (error) {
    return (
      <div className="rounded-[var(--bc-radius-sm)] border border-[hsl(var(--bc-danger)/0.35)] bg-[hsl(var(--bc-danger)/0.1)] p-2 text-xs text-[hsl(2_84%_78%)]">
        Image failed ({error}).
      </div>
    );
  }

  // Locked teaser: render the blurred placeholder with a character-voiced CTA.
  // Tapping anywhere opens the UpgradeModal routed to /billing. The real URL
  // is never sent to this component (only `blurUri` if available, or a dark
  // gradient fallback from the server).
  if (locked) {
    const overlayCtaText = ctaText ?? "Unlock to see this photo";
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-media-id={mediaAssetId}
          className="relative overflow-hidden rounded-[var(--bc-radius-lg)] border border-[hsl(var(--bc-border))] hover:opacity-90 transition-opacity"
          style={{ width: "200px", aspectRatio: "9 / 16", minHeight: "12rem" }}
          aria-label="Unlock photo"
        >
          {blurUri ? (
            <img
              src={blurUri}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              aria-hidden="true"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(135deg, #2a2533, #1a1720)" }}
              aria-hidden="true"
            />
          )}
          {/* Frosted CTA overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-2 p-4 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
            <span className="text-center text-xs font-medium text-white/90 leading-tight">
              {overlayCtaText}
            </span>
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              Unlock
            </span>
          </div>
        </button>
        {open ? (
          <UpgradeModal
            imageSrc={blurUri ?? ""}
            imageAlt={characterName ?? ""}
            imageBlurred
            title="Unlock Premium Photos"
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  if (!url) {
    return (
      <div
        data-media-id={mediaAssetId}
        className="bc-skeleton flex w-48 items-center justify-center rounded-[var(--bc-radius-lg)] text-xs text-[hsl(var(--bc-muted))]"
        style={{ aspectRatio: "9 / 16", minHeight: "12rem" }}
      >
        Generating image...
      </div>
    );
  }

  if (broken) {
    return (
      <button
        type="button"
        data-media-id={mediaAssetId}
        onClick={() => {
          setBroken(false);
          setRetryKey((k) => k + 1);
        }}
        className="flex w-48 flex-col items-center justify-center gap-1 rounded-[var(--bc-radius-lg)] border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-3 text-xs text-[hsl(var(--bc-muted))] hover:bg-[hsl(var(--bc-cream)/0.06)]"
        style={{ aspectRatio: "9 / 16", minHeight: "12rem" }}
      >
        <span className="font-medium text-[hsl(var(--bc-fg))]">Image unavailable</span>
        <span>Tap to retry</span>
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1" data-media-id={mediaAssetId}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="overflow-hidden rounded-[var(--bc-radius)] border border-[hsl(var(--bc-border))] hover:opacity-90 transition-opacity"
          style={{ maxWidth: "200px" }}
          aria-label="View image"
        >
          <img
            key={retryKey}
            src={url}
            alt={caption ?? ""}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="w-full h-auto block"
            style={{ maxHeight: "320px", objectFit: "cover" }}
          />
        </button>
        {caption ? <span className="text-xs text-[hsl(var(--bc-subtle))]">{caption}</span> : null}
      </div>

      {open ? (
        isPremium ? (
          <PaidImageModal url={url} onClose={() => setOpen(false)} />
        ) : (
          <UpgradeModal
            imageSrc={url}
            imageAlt={characterName ?? ""}
            imageBlurred={false}
            title="Unlock Premium Photos"
            onClose={() => setOpen(false)}
          />
        )
      ) : null}
    </>
  );
}

// Image-only lightbox for paid users. Shows the full photo inside the standard
// product ModalCard (rounded-3xl corners, glass gradient bg, rose+violet
// shadow) with nothing else -- no caption, no CTA, no upgrade nudge.
function PaidImageModal({
  url,
  onClose,
}: {
  url: string;
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
    <ModalOverlay
      role="dialog"
      aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <ModalCard size="md" className="overflow-hidden">
        <ModalCloseButton onClick={onClose} />
        <img
          src={url}
          alt=""
          className="block w-full h-auto"
          style={{ maxHeight: "80vh", objectFit: "contain" }}
        />
      </ModalCard>
    </ModalOverlay>
  );
}
