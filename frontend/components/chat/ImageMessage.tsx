"use client";

// Inline image bubble. Shows a loading skeleton while generating, then a
// natural-aspect thumbnail. Clicking opens a modal with the full image on
// the left and an upgrade / browse CTA on the right.

import * as React from "react";
import { Lock } from "lucide-react";
import { ModalOverlay, ModalCard, ModalCloseButton } from "@/components/ui/Modal";

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
            src={url}
            alt={caption ?? ""}
            loading="lazy"
            className="w-full h-auto block"
            style={{ maxHeight: "320px", objectFit: "cover" }}
          />
        </button>
        {caption ? <span className="text-xs text-[hsl(var(--bc-subtle))]">{caption}</span> : null}
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
    <ModalOverlay
      role="dialog"
      aria-modal
      backdropOpacity={0.82}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <ModalCard size="xl" className="max-h-[90vh]">
        <ModalCloseButton onClick={onClose} />

        <div className="relative flex flex-col md:flex-row">
          {/* Left: image. Chat images are always 9:16 (portrait); we lock
              the left panel to that aspect and use object-cover so the
              image fills edge-to-edge with no letterbox bar showing the
              ModalCard's rose gradient behind it. On mobile it takes
              full modal width; on md+ it is a 45% column. */}
          <div
            className="relative w-full flex-none overflow-hidden md:w-[45%]"
            style={{ aspectRatio: "9 / 16", backgroundColor: "hsl(var(--buttercupp-bg))" }}
          >
            <img
              src={url}
              alt={caption ?? ""}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          </div>

          {/* Right: upgrade CTA. Divider stacks (border-top) on mobile and
              becomes a vertical rule (border-left) side-by-side on md+. */}
          <div
            className="flex flex-1 flex-col justify-center gap-5 border-t p-6 sm:p-7 md:border-l md:border-t-0"
            style={{ borderColor: "hsl(var(--buttercupp-border))" }}
          >
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(135deg, hsl(var(--bc-amber) / 0.25), hsl(var(--bc-honey) / 0.25))",
            }}
          >
            <Lock className="h-5 w-5" style={{ color: "hsl(var(--bc-amber))" }} />
          </div>

          <div>
            <h2
              className="font-display text-xl font-semibold leading-snug"
              style={{ color: "hsl(0 0% 98%)" }}
            >
              Unlock unlimited images
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              Upgrade to Premium for unlimited image generation, exclusive content, and deeper connections with your companions.
            </p>
          </div>

          <a
            href="/billing"
            className="flex items-center justify-center rounded-[var(--bc-radius)] px-5 py-3 text-sm font-semibold text-[hsl(28_45%_9%)] shadow-sm transition-opacity hover:opacity-90"
            style={{
              backgroundImage: "var(--bc-gradient-brand-h)",
            }}
          >
            Upgrade to Premium
          </a>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(var(--bc-muted))" }}>
              Or chat for free with:
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="/discover"
                className="flex items-center gap-3 rounded-xl p-3 transition-colors"
                style={{
                  backgroundColor: "hsl(var(--bc-surface-2))",
                  border: "1px solid hsl(var(--bc-border))",
                  color: "hsl(0 0% 98%)",
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--bc-amber) / 0.3), hsl(var(--bc-honey) / 0.3))",
                    color: "hsl(var(--bc-amber))",
                  }}
                >
                  S
                </div>
                <div>
                  <p className="text-sm font-medium">Explore Free Companions</p>
                  <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>Browse all available characters</p>
                </div>
              </a>

              <a
                href="/gallery"
                className="flex items-center gap-3 rounded-xl p-3 transition-colors"
                style={{
                  backgroundColor: "hsl(var(--bc-surface-2))",
                  border: "1px solid hsl(var(--bc-border))",
                  color: "hsl(0 0% 98%)",
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--bc-honey) / 0.3), hsl(var(--bc-amber) / 0.3))",
                    color: "hsl(var(--bc-honey))",
                  }}
                >
                  G
                </div>
                <div>
                  <p className="text-sm font-medium">Community Gallery</p>
                  <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>Discover community-created companions</p>
                </div>
              </a>
            </div>
          </div>
          </div>
        </div>
      </ModalCard>
    </ModalOverlay>
  );
}
