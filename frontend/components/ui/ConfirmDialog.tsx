"use client";

// Destructive-confirm dialog. Deliberately generic: pass a title +
// description + confirm label, receive callbacks. Focus-trap is
// scoped to Escape and outside-click (no full Tab cycle here; the
// dialog has two buttons and the browser handles Tab within them).

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="dialog"
      aria-modal
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
        style={{
          border: "1px solid hsl(var(--buttercupp-border))",
          backgroundColor: "hsl(var(--buttercupp-surface))",
        }}
      >
        <div className="flex items-start gap-3 p-6">
          {destructive ? (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
            >
              <AlertTriangle className="h-5 w-5" style={{ color: "rgb(248,113,113)" }} />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <h2
              id="confirm-dialog-title"
              className="font-display text-lg font-semibold"
              style={{ color: "hsl(var(--buttercupp-fg))" }}
            >
              {title}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              {description}
            </p>
          </div>
        </div>
        <div
          className="flex items-center justify-end gap-2 border-t p-4"
          style={{ borderColor: "hsl(var(--buttercupp-border))" }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="confirm-dialog-cancel"
            className="tap-target rounded-full px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-60"
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
              "tap-target rounded-full px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-60",
            )}
            style={{
              backgroundColor: destructive
                ? "rgb(220,38,38)"
                : "hsl(var(--buttercupp-accent-rose))",
            }}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
