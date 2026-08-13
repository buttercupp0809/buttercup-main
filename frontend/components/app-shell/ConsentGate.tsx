"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

interface Props {
  needsConsent: boolean;
  children: React.ReactNode;
}

export function ConsentGate({ needsConsent, children }: Props) {
  const router = useRouter();
  const [dob, setDob] = React.useState("");
  const [tosAccepted, setTosAccepted] = React.useState(false);
  const [privacyAccepted, setPrivacyAccepted] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!needsConsent) return <>{children}</>;

  // Max DOB for 18+ (today minus 18 years)
  const maxDob = new Date(Date.now() - 18 * 365.25 * 86_400_000)
    .toISOString()
    .split("T")[0];

  async function agree(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/age/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dob: new Date(dob).toISOString(),
        jurisdiction: "IN",
        tosAccepted,
        privacyAccepted,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const code = body.error ?? "verification_failed";
      setErr(
        code === "under_min_age"
          ? "You must be 18 or older to use Poppy."
          : "Verification failed. Please try again.",
      );
      return;
    }
    // Mark consent in a long-lived cookie so the client reflects it immediately.
    document.cookie = "consent_v1=1; max-age=31536000; path=/; SameSite=Lax";
    router.refresh();
  }

  async function decline() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
  }

  const canSubmit = tosAccepted && privacyAccepted && dob.length > 0 && !busy;

  return (
    <>
      {/* App shell blurred underneath the gate */}
      <div className="pointer-events-none select-none blur-sm">{children}</div>

      {/* Fullscreen consent overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
        <div
          className="buttercupp-glass w-full max-w-md rounded-2xl p-8 shadow-2xl"
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface))",
            borderColor: "hsl(var(--buttercupp-border))",
            border: "1px solid",
          }}
        >
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Age verification
          </h1>
          <p className="mt-2 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            Poppy is exclusively for adults aged 18 and over. Confirm your date of
            birth and accept our policies to continue.
          </p>

          <form onSubmit={agree} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "hsl(var(--buttercupp-fg))" }}>Date of birth</span>
              <input
                type="date"
                required
                max={maxDob}
                className="rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                style={{
                  borderColor: "hsl(var(--buttercupp-border))",
                  backgroundColor: "hsl(var(--buttercupp-surface-2))",
                  color: "hsl(var(--buttercupp-fg))",
                }}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </label>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-rose-500"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
              />
              <span style={{ color: "hsl(var(--buttercupp-fg))" }}>
                I accept the{" "}
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  Terms of Service
                </a>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-rose-500"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
              />
              <span style={{ color: "hsl(var(--buttercupp-fg))" }}>
                I accept the{" "}
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href="/legal/cookie"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  Cookie Policy
                </a>
              </span>
            </label>

            {err ? (
              <p className="text-sm" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>
                {err}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 rounded-lg py-3 text-sm font-semibold transition disabled:opacity-50"
              style={{
                backgroundColor: "hsl(var(--buttercupp-accent-rose))",
                color: "hsl(var(--buttercupp-primary-fg))",
              }}
            >
              {busy ? "Verifying..." : "I agree, continue"}
            </button>

            <button
              type="button"
              onClick={decline}
              className="py-1 text-center text-xs transition hover:underline"
              style={{ color: "hsl(var(--buttercupp-muted))" }}
            >
              Decline and sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
