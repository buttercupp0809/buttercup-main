"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Shared sidebar/mobile-drawer primary nav item. Uses the honey -> amber
// brand gradient already exposed by `ProfileMenu`'s avatar ring and the
// `PremiumPill`. The gradient border is a genuine stroke (mask-composite trick
// on a positioned pseudo-layer), not a solid line, so it reads as one designed
// system rather than a flat outline.
//
// State model:
//  - active   : gradient border at full opacity, low-opacity gradient wash
//               inside, icon+label tinted toward the amber accent
//  - hover    : gradient border fades in at ~55% opacity, glass-style surface
//               wash fades in, icon shifts toward amber
//  - resting  : transparent, muted foreground text
//  - collapsed: same treatment compressed into a 40x40 tile
//
// The gradient-border technique mirrors `PremiumPill` (outer gradient layer
// with an inner solid fill), implemented here with `mask-composite: exclude`
// so a single element paints only the ring, freeing the interior for a
// separate wash layer.

interface NavItemLinkProps {
  href: string;
  label: string;
  testid: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  collapsed: boolean;
  // Suffix appended to the testid for the mobile-drawer variant. The base
  // testid is preserved so existing e2e locators (nav-chats, nav-discover, ...)
  // keep resolving without modification.
  testIdSuffix?: string;
  // Mobile drawer focuses the first item on open; expose the ref so callers
  // can wire that up without forking a second copy of this component.
  firstLinkRef?: React.Ref<HTMLAnchorElement>;
}

// Renders once per surface (SideNav, MobileNav). The linearGradient id is
// referenced by `stroke="url(#buttercupp-nav-gradient)"` inline styles applied
// to lucide icons on active/hover. Two ids are provided (sidenav + mobile) so
// duplicate ids do not collide when both surfaces mount, e.g. during
// responsive tests that toggle viewport widths.
export function NavGradientDefs({ id = "buttercupp-nav-gradient" }: { id?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(var(--bc-honey))" />
          <stop offset="100%" stopColor="hsl(var(--bc-amber))" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Shared style objects so hover transitions on the border / wash layers stay
// in sync and we do not allocate fresh objects per render just for CSS vars.
const GRADIENT_BG =
  "linear-gradient(90deg, hsl(var(--bc-honey)), hsl(var(--bc-amber)))";
const GRADIENT_WASH =
  "linear-gradient(90deg, hsl(var(--bc-honey) / 0.14), hsl(var(--bc-amber) / 0.14))";
const GRADIENT_WASH_HOVER =
  "linear-gradient(90deg, hsl(var(--bc-honey) / 0.08), hsl(var(--bc-amber) / 0.08))";

// mask-composite: exclude paints only where the outer mask (full box) and the
// inner mask (content-box, i.e. inside the 1.5px padding) do NOT overlap.
// Net effect: a 1.5px gradient ring hugging the rounded corners.
const RING_MASK_STYLE: React.CSSProperties = {
  padding: "1.5px",
  background: GRADIENT_BG,
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
  // Standard spec name; Safari still needs the -webkit- prefixed pair above.
  maskComposite: "exclude",
};

export function NavItemLink({
  href,
  label,
  testid,
  icon: Icon,
  active,
  collapsed,
  testIdSuffix = "",
  gradientId = "buttercupp-nav-gradient",
  firstLinkRef,
}: NavItemLinkProps & { gradientId?: string }) {
  const iconGradientStyle: React.CSSProperties = active
    ? { stroke: `url(#${gradientId})` }
    : {};

  return (
    <Link
      ref={firstLinkRef}
      href={href}
      data-testid={`${testid}${testIdSuffix}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative isolate flex items-center overflow-hidden text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        collapsed
          ? "h-10 w-10 justify-center rounded-xl"
          : "gap-3 rounded-xl px-3 py-2",
        active
          ? "text-[hsl(var(--bc-fg))]"
          : "text-[hsl(var(--bc-muted))] hover:text-[hsl(var(--bc-fg))]",
      )}
      style={{
        outlineColor: "hsl(var(--bc-amber))",
      }}
    >
      <span
        aria-hidden
        data-testid={`${testid}-wash${testIdSuffix}`}
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-200",
          active
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100",
        )}
        style={{
          background: active ? GRADIENT_WASH : GRADIENT_WASH_HOVER,
          backdropFilter: active ? undefined : "blur(6px)",
        }}
      />

      <span
        aria-hidden
        data-testid={`${testid}-ring${testIdSuffix}`}
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-200",
          active
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-55",
        )}
        style={RING_MASK_STYLE}
      />

      <Icon
        className={cn(
          "relative h-5 w-5 shrink-0 transition-colors duration-200",
          active ? "" : "group-hover:text-[hsl(var(--bc-amber))]",
        )}
        style={iconGradientStyle}
      />
      {!collapsed ? (
        <span className="relative truncate">{label}</span>
      ) : null}
    </Link>
  );
}
