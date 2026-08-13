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
    <main className="flex min-h-screen">
      {/* Left panel - decorative, desktop only */}
      <div
        className="hidden md:flex md:w-1/2 relative overflow-hidden flex-col"
        style={{
          background: `
            radial-gradient(circle at 30% 40%, hsl(344 84% 71% / 0.35) 0%, transparent 55%),
            radial-gradient(circle at 70% 70%, hsl(262 72% 68% / 0.25) 0%, transparent 50%),
            hsl(240 20% 5%)
          `,
        }}
        aria-hidden="true"
      >
        {/* Wordmark */}
        <div className="absolute top-8 left-10 z-10">
          <a
            href="/"
            className="font-display text-lg tracking-tight cursor-pointer"
            style={{
              background: "linear-gradient(135deg, hsl(344 84% 71%), hsl(262 72% 68%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ButterCupp
          </a>
        </div>

        {/* Floating decorative circles */}
        <div
          className="absolute rounded-full"
          style={{
            width: "22rem",
            height: "22rem",
            top: "-4rem",
            right: "-6rem",
            background: "hsl(262 72% 68% / 0.18)",
            filter: "blur(64px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "16rem",
            height: "16rem",
            bottom: "6rem",
            left: "-3rem",
            background: "hsl(344 84% 71% / 0.22)",
            filter: "blur(48px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "10rem",
            height: "10rem",
            top: "55%",
            right: "10%",
            background: "hsl(348 62% 77% / 0.15)",
            filter: "blur(40px)",
          }}
        />

        {/* Small floating accent dots */}
        <div
          className="absolute rounded-full"
          style={{
            width: "6px",
            height: "6px",
            top: "38%",
            left: "22%",
            background: "hsl(344 84% 71% / 0.55)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "4px",
            height: "4px",
            top: "62%",
            left: "58%",
            background: "hsl(262 72% 68% / 0.45)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "5px",
            height: "5px",
            top: "24%",
            left: "65%",
            background: "hsl(348 62% 77% / 0.4)",
          }}
        />

        {/* Tagline, anchored low-left */}
        <div className="absolute bottom-16 left-10 right-10 z-10">
          <p
            className="font-display leading-tight"
            style={{
              fontSize: "clamp(2.5rem, 4vw, 3.75rem)",
              fontStyle: "italic",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              background: "linear-gradient(135deg, hsl(0 0% 98% / 0.92) 0%, hsl(344 84% 71% / 0.8) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              textWrap: "balance",
            }}
          >
            Your companion awaits.
          </p>
          <p
            className="mt-3 text-sm"
            style={{ color: "hsl(240 6% 65% / 0.75)" }}
          >
            Sign in and pick up where you left off.
          </p>
        </div>
      </div>

      {/* Right panel - form */}
      <div
        className="flex w-full md:w-1/2 flex-col items-center justify-center px-6 py-12 min-h-screen"
        style={{ backgroundColor: "hsl(240 14% 9%)" }}
      >
        {/* Mobile wordmark - only visible below md */}
        <div className="mb-8 md:hidden">
          <a
            href="/"
            className="font-display text-2xl tracking-tight"
            style={{
              background: "linear-gradient(135deg, hsl(344 84% 71%), hsl(262 72% 68%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ButterCupp
          </a>
        </div>

        <div
          className="buttercupp-glass rounded-2xl p-8 w-full"
          style={{ maxWidth: "26rem" }}
        >
          {/* Form header wordmark - desktop */}
          <div className="hidden md:block mb-6">
            <a
              href="/"
              className="font-display text-xl tracking-tight cursor-pointer"
              style={{
                background: "linear-gradient(135deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              ButterCupp
            </a>
          </div>

          <h1 className="font-display text-3xl font-semibold tracking-tight" style={{ textWrap: "balance" }}>
            Welcome back, love
          </h1>
          <p className="mb-6 mt-1.5 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            Your companion is waiting.
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
            <a
              href="/signup"
              className="font-medium underline"
              style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
            >
              Create one
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
