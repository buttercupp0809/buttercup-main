"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/PasswordField";
import { GoogleButton } from "@/components/auth/GoogleButton";

// Turns a 400 body into something a human can act on. The signup API returns
// { error, issues?: [{ path, message }] } (issues on Zod validation_failed).
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

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = React.useState({
    email: "",
    password: "",
    dob: "",
    jurisdiction: "US",
    // Implicit consent: creating an account IS the acceptance. We keep the
    // audit trail server-side (tosAcceptedAt / privacyAcceptedAt) but no
    // longer make the user tick boxes.
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
    borderColor: "hsl(var(--poppy-border))",
    backgroundColor: "hsl(var(--poppy-surface))",
    color: "hsl(var(--poppy-fg))",
  } as const;
  const inputCls = "rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="poppy-glass rounded-2xl p-8">
        <a href="/" className="font-display text-2xl font-semibold tracking-tight">
          Poppy
        </a>
        <h1 className="font-display mt-6 mb-6 text-3xl font-semibold tracking-tight">
          Create your account
        </h1>
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
        <label className="flex flex-col gap-1 text-sm">
          Country (ISO 2-letter)
          <input
            required
            maxLength={2}
            className={`${inputCls} uppercase`}
            style={inputStyle}
            value={form.jurisdiction}
            onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
          />
        </label>
        {err ? <p className="text-sm text-rose-400">{err}</p> : null}
        <Button type="submit" disabled={busy || !passwordValid}>
          {busy ? "Creating account..." : "Create account"}
        </Button>
        <p className="text-center text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
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
        style={{ color: "hsl(var(--poppy-muted))" }}
      >
        <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--poppy-border))" }} />
        <span>or</span>
        <div className="h-px flex-1" style={{ backgroundColor: "hsl(var(--poppy-border))" }} />
      </div>
      <GoogleButton mode="signup_with" />
      <p className="mt-6 text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
        Already have an account?{" "}
        <a href="/login" className="font-medium underline" style={{ color: "hsl(var(--poppy-accent-rose))" }}>
          Sign in
        </a>
      </p>
      </div>
    </main>
  );
}
