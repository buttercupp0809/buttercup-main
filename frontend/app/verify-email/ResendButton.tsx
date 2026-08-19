"use client";

// Client-side resend trigger. The server route is rate-limited (60s per user);
// we surface 429/retryAfter in the button label so the user knows to wait.

import { useState } from "react";
import { Send, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; msg: string };

export function ResendVerificationButton() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onClick() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retryAfter?: number };
        const secs = body.retryAfter ?? 60;
        setState({ kind: "error", msg: `Please wait ${secs}s before resending.` });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", msg: "Could not resend. Try again shortly." });
        return;
      }
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", msg: "Network error. Try again." });
    }
  }

  const disabled = state.kind === "sending" || state.kind === "sent";

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-testid="verify-email-resend"
        className="w-full"
      >
        {state.kind === "sent" ? (
          <Check className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {state.kind === "sending"
          ? "Sending..."
          : state.kind === "sent"
            ? "Sent. Check your inbox."
            : "Resend verification email"}
      </Button>
      {state.kind === "error" ? (
        <p
          role="alert"
          className="text-xs"
          style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
        >
          {state.msg}
        </p>
      ) : null}
    </div>
  );
}
