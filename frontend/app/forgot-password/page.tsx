"use client";
import * as React from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandRow } from "@/components/brand/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    // Always show the same confirmation (no account enumeration).
    setSent(true);
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 px-safe py-12 pb-safe"
      style={{ backgroundColor: "hsl(var(--bc-surface))", color: "hsl(var(--bc-fg))" }}
    >
      {/* Brand lockup above the card */}
      <div className="mb-8">
        <a href="/" className="inline-flex">
          <BrandRow markSize={32} />
        </a>
      </div>

      <div className="bc-rise buttercupp-glass w-full rounded-2xl p-8" style={{ maxWidth: "26rem" }}>
        <div
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bc-honey) / 0.2), hsl(var(--bc-amber) / 0.2))",
            color: "hsl(var(--bc-amber))",
          }}
          aria-hidden
        >
          <KeyRound className="h-5 w-5" />
        </div>
        <h1
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Reset password
        </h1>
        {sent ? (
          <div className="mt-5 flex flex-col gap-4">
            <p
              className="rounded-xl border px-3.5 py-3 text-sm"
              style={{
                borderColor: "hsl(var(--bc-success) / 0.4)",
                backgroundColor: "hsl(var(--bc-success) / 0.08)",
                color: "hsl(var(--bc-muted))",
              }}
            >
              If an account exists for <strong style={{ color: "hsl(var(--bc-fg))" }}>{email}</strong>, a reset link is on its way. Check
              your inbox (and spam). The link expires shortly.
            </p>
            <a
              href="/login"
              className="text-sm font-medium underline"
              style={{ color: "hsl(var(--bc-amber))" }}
            >
              Back to sign in
            </a>
          </div>
        ) : (
          <>
            <p className="mb-6 mt-1.5 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
              Enter your email and we will send you a link to choose a new password.
            </p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className="rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
                  style={{
                    borderColor: "hsl(var(--bc-border))",
                    backgroundColor: "hsl(var(--bc-surface-2))",
                    color: "hsl(var(--bc-fg))",
                  }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send reset link"}
              </Button>
            </form>
            <p className="mt-6 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
              Remembered it?{" "}
              <a
                href="/login"
                className="font-medium underline"
                style={{ color: "hsl(var(--bc-amber))" }}
              >
                Sign in
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
