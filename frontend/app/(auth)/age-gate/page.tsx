"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Age &amp; compliance</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        ButterCupp is only available to adults. Enter your date of birth and confirm
        acceptance of our Terms and Privacy Policy to continue.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Date of birth
          <input
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
            value={form.dob}
            onChange={(e) => setForm({ ...form, dob: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Country (ISO 2-letter)
          <input
            required
            maxLength={2}
            className="rounded-md border border-slate-300 px-3 py-2 uppercase"
            value={form.jurisdiction}
            onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.tosAccepted}
            onChange={(e) => setForm({ ...form, tosAccepted: e.target.checked })}
          />
          I accept the{" "}
          <a
            href="/legal/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Terms of Service
          </a>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.privacyAccepted}
            onChange={(e) => setForm({ ...form, privacyAccepted: e.target.checked })}
          />
          I accept the{" "}
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Privacy Policy
          </a>
        </label>
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Verifying..." : "Continue"}
        </Button>
      </form>
    </main>
  );
}
