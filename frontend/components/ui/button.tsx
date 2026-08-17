import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Shared button primitive. Phase 32.1 unified the marketing site + auth pages
// on the pink -> purple gradient shown in the Hero CTA ("Create your
// companion"). `default` is the gradient pill; `outline` is the rose-bordered
// "Browse"-style pill that pairs with it. Every button on the public site,
// header, and login/signup pages routes through this component so a token
// tweak here changes them all in one place.
//
// The gradient is defined as a single CSS variable (--buttercupp-gradient-cta)
// so any consumer that needs the same swatch (icon backgrounds, text-clip
// headlines, active-slide dots) can reference it instead of hardcoding the
// two hsl() stops.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Gradient CTA. Lifts on hover with a soft rose glow, presses back on
        // active; consistent across marketing hero, home footer CTA, header
        // Create/Dashboard, login/signup submit buttons.
        default: [
          "text-white shadow-[0_8px_24px_-12px_hsl(344_84%_71%/0.55)]",
          "bg-[linear-gradient(90deg,hsl(344_84%_71%),hsl(262_72%_68%))]",
          "hover:brightness-110 hover:shadow-[0_12px_32px_-10px_hsl(344_84%_71%/0.6)]",
          "active:brightness-95 active:shadow-[0_4px_12px_-4px_hsl(344_84%_71%/0.5)]",
        ].join(" "),
        // Rose-bordered ghost pill (matches "Browse" in the hero). Fills on
        // hover with a tinted rose background so the pairing reads as one
        // system rather than two disconnected buttons.
        outline: [
          "border bg-transparent text-[hsl(344_84%_71%)]",
          "border-[hsl(344_84%_71%/0.5)]",
          "hover:bg-[hsl(344_84%_71%/0.1)] hover:border-[hsl(344_84%_71%/0.75)] hover:text-[hsl(344_84%_78%)]",
          "active:bg-[hsl(344_84%_71%/0.15)]",
        ].join(" "),
        ghost: "text-[hsl(var(--buttercupp-fg))] hover:bg-white/5",
      },
      size: {
        default: "h-10 px-5 py-2 text-sm",
        sm: "h-9 px-3.5 text-sm",
        lg: "h-11 px-6 text-base",
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
