"use client";

// Inline image bubble. Shows a loading skeleton while generating, then a
// natural-aspect thumbnail. Clicking opens a lightbox that shows ONLY the
// full image (no caption, no paywall, no CTA). The upsell lives elsewhere
// (the in-conversation "Want more photos" nudge and the quota PaywallModal),
// never inside the click-to-expand view of a chat-generated image.

import * as React from "react";
import { ModalOverlay, ModalCloseButton } from "@/components/ui/Modal";

interface Props {
  mediaAssetId: string;
  url: string | null;
  caption?: string;
  error?: string | null;
}

export function ImageMessage({ mediaAssetId, url, caption, error }: Props) {
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
          {/*
            Alt text is intentionally empty (or the user's caption). A
            literal "generated" fallback leaks into the message bubble as
            broken-image text if the URL ever 404s, which is confusing to
            the user; the image is decorative from an a11y standpoint
            (the surrounding message says the character sent a photo).
          */}
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
        <ImageModal url={url} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

// Image-only lightbox for a chat-generated image. Deliberately bare: just the
// whole image (object-contain, capped to the viewport), a dark backdrop, a
// close button, and click-outside / Escape to dismiss. No caption, no paywall,
// no CTA. This is intentionally NOT built on ModalCard (which paints a rose
// gradient + hairline + corner glows) so nothing frames the image.
function ImageModal({
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
      backdropOpacity={0.92}
      disableAmbientGlow
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative my-auto flex max-h-[90vh] max-w-[92vw] items-center justify-center">
        <ModalCloseButton onClick={onClose} />
        <img
          src={url}
          alt=""
          className="block max-h-[90vh] max-w-[92vw] w-auto h-auto object-contain"
        />
      </div>
    </ModalOverlay>
  );
}
