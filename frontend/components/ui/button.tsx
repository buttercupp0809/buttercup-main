import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Shared button primitive. Every button on the marketing site, header, auth
// pages and app shell routes through here, so a change in this file changes
// them all.
//
// The primary action is a solid amber pill with ink-dark text. That is the
// brand's own motif: the logo lockup highlights "GF" as a dark word on an amber
// chip, so the same pairing on a CTA makes the button feel like it came out of
// the logo. Amber at full saturation against dark ink also clears AA
// comfortably, which a white-on-amber pill would not.
//
// Interaction rules applied to every variant:
//   - transitions name their properties (never `all`), so hover, press and
//     focus do not fight each other
//   - active presses to 0.96 via a transition, not a keyframe, so a fast
//     double-tap retargets instead of restarting from zero
//   - the focus ring is amber at 2px with a 2px offset
const buttonVariants = cva(
  [
    "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "font-semibold tracking-tight",
    "transition-[transform,background-color,border-color,color,box-shadow,filter] duration-200 ease-[var(--ease-out)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bc-bg))]",
    "active:scale-[0.96] motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50",
  ].join(" "),
  {
    variants: {
      variant: {
        // Solid amber. The single highest-intent action on any given screen.
        default: [
          "bg-[hsl(var(--bc-amber))] text-[hsl(28_45%_9%)]",
          "shadow-[0_1px_0_hsl(36_100%_78%/0.5)_inset,0_8px_24px_-10px_hsl(var(--bc-amber)/0.5)]",
          "hover:bg-[hsl(36_100%_56%)] hover:shadow-[0_1px_0_hsl(36_100%_82%/0.6)_inset,0_12px_30px_-10px_hsl(var(--bc-amber)/0.6)]",
        ].join(" "),
        // Honey to amber sweep. Reserved for the one hero CTA per page; using
        // it twice on a screen flattens the hierarchy the solid variant sets up.
        brand: [
          "text-[hsl(28_45%_9%)] bg-[image:var(--bc-gradient-brand-v)]",
          "shadow-[0_1px_0_hsl(36_100%_84%/0.55)_inset,0_10px_30px_-10px_hsl(var(--bc-amber)/0.55)]",
          "hover:brightness-[1.06] hover:shadow-[0_1px_0_hsl(36_100%_86%/0.6)_inset,0_14px_36px_-10px_hsl(var(--bc-amber)/0.62)]",
        ].join(" "),
        // Hairline pill that pairs with the solid amber without competing.
        outline: [
          "border border-[hsl(var(--bc-border-strong))] bg-[hsl(var(--bc-surface-2)/0.5)] text-[hsl(var(--bc-fg))]",
          "backdrop-blur-sm",
          "hover:border-[hsl(var(--bc-amber)/0.55)] hover:bg-[hsl(var(--bc-amber)/0.08)] hover:text-[hsl(var(--bc-honey))]",
        ].join(" "),
        ghost: [
          "text-[hsl(var(--bc-muted))]",
          "hover:bg-[hsl(var(--bc-cream)/0.06)] hover:text-[hsl(var(--bc-fg))]",
        ].join(" "),
        // Destructive actions only (delete companion, cancel plan).
        danger: [
          "bg-[hsl(var(--bc-danger)/0.14)] text-[hsl(2_84%_74%)] border border-[hsl(var(--bc-danger)/0.35)]",
          "hover:bg-[hsl(var(--bc-danger)/0.2)] hover:border-[hsl(var(--bc-danger)/0.5)]",
        ].join(" "),
      },
      size: {
        // Heights are all >= 40px so every button clears the minimum hit area
        // without needing a pseudo-element.
        default: "h-10 rounded-[var(--bc-radius-sm)] px-5 text-sm",
        sm: "h-9 rounded-[var(--bc-radius-xs)] px-3.5 text-[0.8125rem]",
        lg: "h-12 rounded-[var(--bc-radius)] px-7 text-[0.9375rem]",
        xl: "h-14 rounded-[var(--bc-radius-lg)] px-9 text-base",
        icon: "size-10 rounded-[var(--bc-radius-sm)]",
        pill: "h-11 rounded-full px-6 text-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
