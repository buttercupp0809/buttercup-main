"use client";

// Shared modal primitives. Every popup in the product (paywall, confirm,
// upgrade, image lightbox, consent) composes these two components so the
// visual language stays consistent and a token tweak lands everywhere at
// once.
//
// Behavior stays with the caller on purpose:
//   - focus traps
//   - ESC handling
//   - entitlement polling / subscribe / accept / decline
//   - open-close state, portals, animations
//
// This file supplies ONLY the shared shell:
//   - <ModalOverlay>: fixed backdrop with ambient rose + violet radial
//     glows, blur, safe-area padding, and items-start on mobile scrolling
//     up to items-center on sm+.
//   - <ModalCard>: rounded, glass-tinted card with the animated gradient
//     hairline, corner glows, rose-tinted border, and multi-color shadow.
//
// Callers pass their own role/aria/testids/onClick and their own content.

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  // Blur intensity of the backdrop. "md" (default) matches PaywallModal; "sm"
  // is enough for lightweight confirms. "lg" is for high-attention consents.
  backdropBlur?: "sm" | "md" | "lg";
  // Backdrop darkness. Higher for lightbox-style modals, lower for gentle
  // confirms. Default 0.75 matches the current PaywallModal.
  backdropOpacity?: number;
  // When true, disables the ambient rose/violet radial glows (used only for
  // stark full-attention overlays where color would compete with content).
  disableAmbientGlow?: boolean;
}

export const ModalOverlay = React.forwardRef<HTMLDivElement, ModalOverlayProps>(function ModalOverlay(
  {
    children,
    className,
    backdropBlur = "md",
    backdropOpacity = 0.75,
    disableAmbientGlow = false,
    style,
    ...rest
  },
  ref,
) {
  const blurClass =
    backdropBlur === "sm" ? "backdrop-blur-sm" : backdropBlur === "lg" ? "backdrop-blur-xl" : "backdrop-blur-md";

  // Portal to <body> so the fixed overlay is positioned against the viewport,
  // not trapped inside an ancestor that establishes a containing block via
  // transform / filter / backdrop-filter (e.g. a hover-lifted card). Without
  // this, opening a modal from inside such a card clips the overlay to the
  // card's box. Mount-gate so SSR does not touch document.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      ref={ref}
      className={cn(
        // items-start on mobile so a tall modal is scrollable from the top;
        // items-center once we have room. overflow-y-auto so the whole
        // overlay scrolls rather than trapping content behind the fold on
        // short viewports. Safe-area padding respects iOS notch/home-bar.
        "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:items-center sm:py-8",
        blurClass,
        className,
      )}
      style={{
        backgroundColor: `hsl(var(--buttercupp-bg) / ${backdropOpacity})`,
        ...style,
      }}
      {...rest}
    >
      {!disableAmbientGlow ? (
        // Ambient rose + violet radial glows mirror the marketing hero so
        // modals feel like the same product, not a third-party iframe.
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-0"
          style={{
            background: `
              radial-gradient(45rem 45rem at 15% 10%, hsl(var(--buttercupp-accent-rose) / 0.18), transparent 60%),
              radial-gradient(40rem 40rem at 90% 90%, hsl(var(--buttercupp-accent-violet) / 0.18), transparent 60%)
            `,
          }}
        />
      ) : null}
      {children}
    </div>,
    document.body,
  );
});

export interface ModalCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  // Approximate max width. Match to the amount of content, not fashion:
  //   sm  ~ 26rem   confirmations, single-column paywalls
  //   md  ~ 32rem   consent, single-column upgrade nudges
  //   lg  ~ 42rem   split-panel upgrade with image
  //   xl  ~ 56rem   multi-plan paywall
  size?: "sm" | "md" | "lg" | "xl";
  // When true, removes the rounded-3xl corners on mobile (used for full-
  // height sheets that would otherwise fight the safe-area).
  fullBleedOnMobile?: boolean;
}

const SIZE_TO_MAX: Record<NonNullable<ModalCardProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export const ModalCard = React.forwardRef<HTMLDivElement, ModalCardProps>(function ModalCard(
  { children, className, size = "md", fullBleedOnMobile = false, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative my-auto w-full overflow-hidden shadow-2xl",
        fullBleedOnMobile ? "rounded-none sm:rounded-3xl" : "rounded-3xl",
        SIZE_TO_MAX[size],
        className,
      )}
      style={{
        background:
          "linear-gradient(180deg, hsl(var(--buttercupp-surface) / 0.95), hsl(var(--buttercupp-surface-2) / 0.98))",
        border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.25)",
        boxShadow:
          "0 40px 80px -20px hsl(var(--buttercupp-accent-rose) / 0.25), 0 20px 40px -20px hsl(var(--buttercupp-accent-violet) / 0.25), 0 8px 32px rgba(0, 0, 0, 0.6)",
        ...style,
      }}
      {...rest}
    >
      {/* Animated gradient hairline at the very top edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)), transparent)",
        }}
      />
      {/* Corner glow: rose top-right. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
        style={{ background: "hsl(var(--buttercupp-accent-rose) / 0.25)" }}
      />
      {/* Corner glow: violet bottom-left. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full blur-3xl"
        style={{ background: "hsl(var(--buttercupp-accent-violet) / 0.22)" }}
      />
      {children}
    </div>
  );
});

// Small "minimize / close" affordance shared by modals that expose one.
// Sized to the WCAG 44px minimum via .tap-target so hit area is comfortable
// on touch regardless of visual glyph size.
export interface ModalCloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ariaLabel?: string;
}

export function ModalCloseButton({ ariaLabel = "Close", className, ...rest }: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "tap-target absolute right-3 top-3 z-10 flex items-center justify-center rounded-full border transition hover:opacity-80",
        className,
      )}
      style={{
        borderColor: "hsl(var(--buttercupp-border))",
        background: "hsl(var(--buttercupp-surface-2) / 0.7)",
        color: "hsl(var(--buttercupp-muted))",
      }}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
