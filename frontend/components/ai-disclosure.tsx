// Persistent AI-disclosure indicator (SB 243). Non-dismissible by default.
// Mounted in the (protected) layout so every authenticated surface renders
// it. The chat surface (Phase 04) will consume the same component (or a
// sibling variant that lives at the top of the chat container).

import * as React from "react";
import { cn } from "@/lib/utils";

export interface AiDisclosureProps {
  className?: string;
  variant?: "banner" | "pill";
  label?: string;
}

export function AiDisclosure({
  className,
  variant = "pill",
  label = "You're chatting with an AI",
}: AiDisclosureProps) {
  const base =
    "inline-flex select-none items-center gap-2 text-xs font-medium tracking-wide";
  const styles =
    variant === "banner"
      ? "w-full justify-center border-b border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface)/0.8)] py-2 text-[hsl(var(--bc-muted))]"
      : "rounded-full border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2)/0.7)] px-3 py-1 text-[hsl(var(--bc-muted))] shadow-sm backdrop-blur";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="ai-disclosure"
      className={cn(base, styles, className)}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--bc-amber))]"
      />
      {label}
    </div>
  );
}
