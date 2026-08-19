"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandRow } from "@/components/brand/Logo";

// Age & compliance gate. This page is NOT wrapped by the (protected) layout,
// because that layout redirects to /age-gate when the user is not verified,
// which would loop. It IS still protected: the client submits to
// /api/age/verify which requires an auth cookie; middleware guards that.
export default function AgeGatePage() {
  const router = useRouter();
  const [form, setForm] = React.useState({
    dob: "",
    jurisdiction: "US",
    tosAccepted: false,
    privacyAccepted: false,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/age/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, dob: new Date(form.dob).toISOString() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body.error ?? "Verification failed.");
      return;
    }
    router.push("/dashboard");
  }

  const inputCls = "rounded-md border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]";
  const inputStyle = {
    borderColor: "hsl(var(--bc-border))",
    backgroundColor: "hsl(var(--bc-surface-2))",
    color: "hsl(var(--bc-fg))",
  } as const;

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
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Age &amp; compliance
        </h1>
        <p className="mb-6 mt-1.5 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          ButterCupp is only available to adults. Enter your date of birth and confirm
          acceptance of our Terms and Privacy Policy to continue.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Date of birth
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
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
              style={{ accentColor: "hsl(var(--bc-amber))" }}
              checked={form.tosAccepted}
              onChange={(e) => setForm({ ...form, tosAccepted: e.target.checked })}
            />
            <span>
              I accept the{" "}
              <a
                href="/legal/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "hsl(var(--bc-amber))" }}
              >
                Terms of Service
              </a>
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
              style={{ accentColor: "hsl(var(--bc-amber))" }}
              checked={form.privacyAccepted}
              onChange={(e) => setForm({ ...form, privacyAccepted: e.target.checked })}
            />
            <span>
              I accept the{" "}
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "hsl(var(--bc-amber))" }}
              >
                Privacy Policy
              </a>
            </span>
          </label>
          {err ? (
            <p
              role="alert"
              className="rounded-xl border px-3.5 py-2.5 text-sm"
              style={{
                borderColor: "hsl(var(--bc-danger) / 0.5)",
                backgroundColor: "hsl(var(--bc-danger) / 0.08)",
                color: "hsl(var(--bc-danger))",
              }}
            >
              {err}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Verifying..." : "Continue"}
          </Button>
        </form>
      </div>
    </main>
  );
}
