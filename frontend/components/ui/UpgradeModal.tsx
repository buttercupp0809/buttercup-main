"use client";

// Shared upgrade takeover. Rendered when the user hits a paywalled surface
// outside chat (locked private-content gallery, recurring untalked-to nag,
// etc). Mirrors the Figma "iPhone 17 - 1" pricing hero: the character photo
// fills the entire viewport behind a Monthly/Yearly toggle and a single
// amber CTA. The title / description / ctaLabel props are retained for
// backward compatibility with existing call-sites, but the visual chrome
// (hero layout, trust laurel, toggle, CTA) is delegated to PaywallHero so
// every upgrade surface in the product speaks the same visual language.

import * as React from "react";
import { PaywallHero } from "@/components/paywall/PaywallHero";
import { ModalOverlay } from "@/components/ui/Modal";

export interface UpgradeModalProps {
  // Kept in the type surface so existing call-sites do not have to change.
  // The hero pulls its own headline from the Figma spec by default; a caller
  // that needs different copy can still override via `headline`.
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerText?: string;
  onClose: () => void;
  imageSrc?: string | null;
  imageAlt?: string;
  imageBlurred?: boolean;
  // Optional headline override. Defaults to the shared hero copy so every
  // paywall surface in the product reads the same brand line unless a
  // caller has a strong reason to differ.
  headline?: string;
}

export function UpgradeModal({
  title,
  onClose,
  imageSrc,
  imageAlt,
  imageBlurred = false,
  headline,
  // Silence unused warnings; kept in the API for backward compatibility with
  // existing call-sites while the visual system is unified.
  description: _description,
  ctaLabel: _ctaLabel,
  ctaHref: _ctaHref,
  footerText: _footerText,
}: UpgradeModalProps) {
  // ESC closes the takeover. ModalOverlay does its own portal + mount gate.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Wrap in ModalOverlay so the backdrop, ambient rose+violet glow, blur,
  // safe-area padding, and centering all match every other modal in the
  // product. The blurred-locked-content variant blurs the hero's own
  // background image via a Tailwind child selector so the character
  // silhouette still reads without exposing the locked photo.
  return (
    <ModalOverlay
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="upgrade-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={imageBlurred ? "contents [&_img]:!blur-md [&_img]:!scale-110" : "contents"}>
        <PaywallHero
          heroImageSrc={imageSrc ?? "/personas/1.webp"}
          heroImageAlt={imageAlt ?? ""}
          contextLabel={!imageBlurred && imageAlt ? imageAlt : undefined}
          headline={headline}
          onClose={onClose}
          closeAriaLabel="Close"
        />
      </div>
    </ModalOverlay>
  );
}
