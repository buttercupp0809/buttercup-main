"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/PasswordField";
import { GoogleButton } from "@/components/auth/GoogleButton";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState<string | null>(params.get("error"));
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr("Invalid email or password.");
      return;
    }
    router.push(params.get("next") ?? "/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="buttercupp-glass rounded-2xl p-8">
        <a href="/" className="font-display text-2xl font-semibold tracking-tight">
          ButterCupp
        </a>
        <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mb-6 mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Sign in to continue to your companions.
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
          <PasswordField
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <a
            href="/forgot-password"
            className="-mt-2 self-end text-xs underline"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            Forgot password?
          </a>
          {err ? <p className="text-sm text-rose-400">{err}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <div
          className="my-6 flex items-center gap-3 text-xs"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
          <span>or</span>
          <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
        </div>
        <GoogleButton dest={params.get("next") ?? "/dashboard"} mode="signin_with" />
        <p className="mt-6 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          No account?{" "}
          <a href="/signup" className="font-medium underline" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}
