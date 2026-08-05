"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/PasswordField";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="poppy-glass rounded-2xl p-8">
        <a href="/" className="font-display text-2xl font-semibold tracking-tight">
          Poppy
        </a>
        <h1 className="font-display mt-6 mb-6 text-3xl font-semibold tracking-tight">
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
            {err ? <p className="text-sm text-rose-400">{err}</p> : null}
            <Button type="submit" disabled={busy || !valid}>
              {busy ? "Saving..." : "Set new password"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-rose-400">
            Missing reset token. Please use the link from your email, or{" "}
            <a
              href="/forgot-password"
              className="font-medium underline"
              style={{ color: "hsl(var(--poppy-accent-rose))" }}
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
