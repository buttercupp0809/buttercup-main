"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/PasswordField";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { TrustStrip } from "@/components/trust/TrustStrip";

function errorMessage(body: Record<string, unknown>): string {
  const issues = body?.issues as { path?: unknown[]; message?: string }[] | undefined;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((i) => {
        const field = Array.isArray(i.path) ? String(i.path[i.path.length - 1] ?? "field") : "field";
        return `${field}: ${i.message ?? "invalid"}`;
      })
      .join(" · ");
  }
  const known: Record<string, string> = {
    signup_failed: "That email is already registered. Try logging in.",
    under_min_age: "You must be at least 18 to sign up.",
    must_accept_tos_and_privacy: "Please accept the Terms of Service and Privacy Policy.",
    content_type_must_be_application_json: "Something went wrong sending the form. Please retry.",
  };
  const code = typeof body?.error === "string" ? body.error : "";
  return known[code] ?? code ?? "Signup failed.";
}

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = React.useState({
    email: "",
    password: "",
    dob: "",
    jurisdiction: "US",
    tosAccepted: true,
    privacyAccepted: true,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [passwordValid, setPasswordValid] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, dob: new Date(form.dob).toISOString() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      setErr(errorMessage(body));
      return;
    }
    router.push("/dashboard");
  }

  const inputStyle = {
    borderColor: "hsl(var(--buttercupp-border))",
    backgroundColor: "hsl(var(--buttercupp-surface))",
    color: "hsl(var(--buttercupp-fg))",
  } as const;
  const inputCls = "rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400";

  return (
    <div
      className="flex w-full md:w-1/2 flex-col items-center justify-center px-6 py-12 min-h-screen"
      style={{ backgroundColor: "hsl(240 14% 9%)" }}
    >
      {/* Mobile wordmark */}
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

      <div className="buttercupp-glass rounded-2xl p-8 w-full" style={{ maxWidth: "26rem" }}>
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

        <h1 className="font-display text-3xl font-semibold tracking-tight" style={{ textWrap: "balance" } as React.CSSProperties}>
          Join ButterCupp
        </h1>
        <p className="mb-6 mt-1.5 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Create your account and meet your companion.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              required
              className={inputCls}
              style={inputStyle}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <PasswordField
            label="Password"
            autoComplete="new-password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
            showChecklist
            onValidityChange={setPasswordValid}
          />
          <label className="flex flex-col gap-1 text-sm">
            Date of birth (must be 18+)
            <input
              type="date"
              required
              className={inputCls}
              style={inputStyle}
              value={form.dob}
              onChange={(e) => setForm({ ...form, dob: e.target.value })}
            />
          </label>
          {err ? <p className="text-sm text-rose-400">{err}</p> : null}
          <Button type="submit" disabled={busy || !passwordValid}>
            {busy ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-center text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            By creating an account you agree to our{" "}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline">
              Privacy Policy
            </a>
            .
          </p>
        </form>

        <div
          className="my-6 flex items-center gap-3 text-xs"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
          <span>or</span>
          <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
        </div>

        <GoogleButton mode="signup_with" />

        <p className="mt-6 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium underline"
            style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Sign in
          </a>
        </p>
      </div>

      <div className="mt-6 w-full" style={{ maxWidth: "26rem" }}>
        <TrustStrip />
      </div>
    </div>
  );
}
