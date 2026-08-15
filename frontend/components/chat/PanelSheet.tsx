"use client";

// Reusable mobile/tablet drawer for the chat 3-pane surface. Promotes a pane
// that is normally `hidden` below some breakpoint (ChatList, PersonaPanel)
// into a reachable slide-over (left/right) or bottom sheet. Behavior mirrors
// the existing MobileNav drawer contract: close on Escape, close on scrim
// click, lock body scroll while open, focus-trap, dialog semantics. Styled
// with existing tokens only, no new design tokens.

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PanelSheetProps {
  side: "left" | "right" | "bottom";
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PanelSheet({ side, open, onClose, label, children }: PanelSheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setEntered(true));

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    const firstFocusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)[0];
    firstFocusable?.focus();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const positionClasses =
    side === "left"
      ? "inset-y-0 left-0 h-dvh w-[86vw] max-w-sm border-r pt-safe pb-safe"
      : side === "right"
        ? "inset-y-0 right-0 h-dvh w-[86vw] max-w-sm border-l pt-safe pb-safe"
        : "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t pb-safe";

  const closedTransform =
    side === "left" ? "-translate-x-full" : side === "right" ? "translate-x-full" : "translate-y-full";

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        data-testid="panel-sheet"
        className={cn(
          "absolute flex flex-col overflow-hidden transition-transform duration-300 ease-out",
          positionClasses,
          entered ? "translate-x-0 translate-y-0" : closedTransform,
        )}
        style={{
          backgroundColor: "hsl(var(--buttercupp-bg))",
          borderColor: "hsl(var(--buttercupp-border))",
        }}
      >
        {side === "bottom" ? (
          <div className="flex shrink-0 justify-center pt-2" aria-hidden>
            <span
              className="h-1 w-10 rounded-full"
              style={{ backgroundColor: "hsl(var(--buttercupp-border))" }}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
