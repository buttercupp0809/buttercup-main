"use client";

// Destructive-confirm dialog. Deliberately generic: pass a title +
// description + confirm label, receive callbacks. Focus-trap is
// scoped to Escape and outside-click (no full Tab cycle here; the
// dialog has two buttons and the browser handles Tab within them).

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalOverlay, ModalCard } from "@/components/ui/Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    confirmRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <ModalOverlay
      role="dialog"
      aria-modal
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <ModalCard size="sm">
        <div className="flex items-start gap-3 p-6">
          {destructive ? (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--bc-danger) / 0.15)" }}
            >
              <AlertTriangle className="h-5 w-5" style={{ color: "hsl(2 84% 74%)" }} />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <h2
              id="confirm-dialog-title"
              className="font-display text-lg font-semibold"
              style={{ color: "hsl(var(--bc-fg))" }}
            >
              {title}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              {description}
            </p>
          </div>
        </div>
        <div
          className="flex items-center justify-end gap-2 border-t p-4"
          style={{ borderColor: "hsl(var(--bc-border))" }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="confirm-dialog-cancel"
            className="tap-target rounded-full px-4 py-2 text-sm font-medium text-[hsl(var(--bc-muted))] hover:bg-[hsl(var(--bc-cream)/0.06)] hover:text-[hsl(var(--bc-fg))] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-dialog-confirm"
            className={cn(
              "tap-target rounded-full px-4 py-2 text-sm font-medium shadow disabled:opacity-60",
              destructive ? "text-white" : "text-[hsl(28_45%_9%)]",
            )}
            style={{
              background: destructive
                ? "linear-gradient(90deg, hsl(var(--bc-danger)), hsl(2 74% 48%))"
                : "var(--bc-gradient-brand-v)",
            }}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </ModalCard>
    </ModalOverlay>
  );
}
