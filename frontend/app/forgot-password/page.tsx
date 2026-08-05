"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="buttercupp-glass rounded-2xl p-8">
        <a href="/" className="font-display text-2xl font-semibold tracking-tight">
          ButterCupp
        </a>
        <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">Reset password</h1>
        {sent ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              If an account exists for <strong>{email}</strong>, a reset link is on its way. Check
              your inbox (and spam). The link expires shortly.
            </p>
            <a
              href="/login"
              className="text-sm font-medium underline"
              style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
            >
              Back to sign in
            </a>
          </div>
        ) : (
          <>
            <p className="mb-6 mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Enter your email and we will send you a link to choose a new password.
            </p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className="rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  style={{
                    borderColor: "hsl(var(--buttercupp-border))",
                    backgroundColor: "hsl(var(--buttercupp-surface))",
                    color: "hsl(var(--buttercupp-fg))",
                  }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send reset link"}
              </Button>
            </form>
            <p className="mt-6 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Remembered it?{" "}
              <a
                href="/login"
                className="font-medium underline"
                style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
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
