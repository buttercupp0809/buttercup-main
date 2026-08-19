"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/PasswordField";
import { BrandRow } from "@/components/brand/Logo";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [valid, setValid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      setErr(
        body.error === "invalid_or_expired_token"
          ? "This reset link is invalid or has expired. Request a new one."
          : "Could not reset your password. Please try again.",
      );
      return;
    }
    // Signed in by the route; land in the app.
    router.push("/dashboard");
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
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h1
          className="font-display mb-6 text-3xl font-semibold tracking-tight"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Choose a new password
        </h1>
        {token ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <PasswordField
              label="New password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              showChecklist
              onValidityChange={setValid}
            />
            {err ? <p className="text-sm" style={{ color: "hsl(var(--bc-danger))" }}>{err}</p> : null}
            <Button type="submit" disabled={busy || !valid}>
              {busy ? "Saving..." : "Set new password"}
            </Button>
          </form>
        ) : (
          <p
            role="alert"
            className="rounded-xl border px-3.5 py-3 text-sm"
            style={{
              borderColor: "hsl(var(--bc-danger) / 0.5)",
              backgroundColor: "hsl(var(--bc-danger) / 0.08)",
              color: "hsl(var(--bc-danger))",
            }}
          >
            Missing reset token. Please use the link from your email, or{" "}
            <a
              href="/forgot-password"
              className="font-medium underline"
              style={{ color: "hsl(var(--bc-amber))" }}
            >
              request a new one
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
