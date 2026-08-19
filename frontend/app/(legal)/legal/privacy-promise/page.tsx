import Link from "next/link";
import { TRUST_HEADLINE, TRUST_PROMISES } from "@/components/trust/copy";

// Public-facing, plain-English privacy explainer. Unlike the sibling
// /legal/* pages, this one is NOT a draft-template placeholder for
// counsel: it is the marketing-facing translation of the actual posture
// (TLS in transit, KMS at rest, ownerUserId scoping, 18+ gate, one-tap
// delete, no data sale, no third-party training on private chats). The
// legally-binding Privacy Policy lives at /legal/privacy and remains the
// source of truth for counsel-approved language; this page cross-links
// there so we never diverge in a load-bearing way.
//
// Registered in frontend/lib/legal/config.ts so it appears automatically
// in the site footer alongside Terms, Privacy, and the rest.

export const metadata = {
  title: "Privacy promise \u00b7 ButterCupp",
  description:
    "The plain-English version of how ButterCupp treats your chats, your companions, and your account. Locked, yours alone, never trained on, yours to erase.",
};

// FAQ pairs kept in one place so a copy tweak lands in exactly one spot.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Can anyone else see my companions or chats?",
    a: "No. Every companion you create is tied to your account and is server-scoped to you. Other users cannot browse, search, or stumble into them, and they never appear on the public site.",
  },
  {
    q: "Are my messages actually encrypted?",
    a: "Yes. Messages travel over an encrypted connection (HTTPS) and are stored encrypted at rest using AWS-managed keys. We do not offer end-to-end encryption today, and we will never claim that we do. What we do offer is strong industry-standard protection and strict access controls.",
  },
  {
    q: "Do you use my private chats to train AI?",
    a: "No. Your private chats are not sold and are not used to train third-party models. If we ever change how we improve our own systems, we will tell you in advance and give you a clear opt-out.",
  },
  {
    q: "What if I want everything gone?",
    a: "You can delete any companion from Your Companions with one tap, and you can delete your entire account from Settings. When you delete your account, your profile, chats, memories, and generated media are removed from our systems.",
  },
  {
    q: "Will this appear on my credit card statement?",
    a: "We use a discreet, neutral descriptor for billing so it never advertises what you subscribed to. If you have a specific concern, contact us before you subscribe and we will walk you through it.",
  },
  {
    q: "Who is allowed to use ButterCupp?",
    a: "Adults only. You must be 18 or older, and we run an age check before onboarding. If you land here and you are under 18, please leave.",
  },
];

export default function PrivacyPromisePage() {
  return (
    <main
      className="relative mx-auto max-w-4xl px-6 pb-24 pt-16"
      style={{ color: "hsl(var(--buttercupp-fg))" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 0%, hsl(var(--buttercupp-accent-rose) / 0.14), transparent 70%)",
        }}
      />

      <div className="text-center">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
          style={{
            borderColor: "hsl(var(--buttercupp-accent-rose) / 0.4)",
            color: "hsl(var(--buttercupp-accent-rose))",
            background: "hsl(var(--buttercupp-accent-rose) / 0.08)",
          }}
        >
          <LockGlyph className="h-3 w-3" />
          Privacy promise
        </span>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          {TRUST_HEADLINE}
        </h1>
        <p
          className="mx-auto mt-3 max-w-2xl text-pretty"
          style={{ color: "hsl(var(--bc-muted))" }}
        >
          This is the human version. If you want the lawyerly one, our{" "}
          <Link href="/legal/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          is one click away.
        </p>
      </div>

      <section className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {TRUST_PROMISES.map((p) => (
          <div
            key={p.id}
            className="buttercupp-glass relative flex flex-col gap-3 overflow-hidden rounded-2xl p-6"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle, hsl(var(--buttercupp-accent-violet) / 0.3), transparent 70%)",
              }}
            />
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl text-xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.18), hsl(var(--buttercupp-accent-violet) / 0.18))",
                border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.25)",
              }}
              aria-hidden
            >
              {p.emoji}
            </div>
            <h2 className="font-display text-lg font-semibold">{p.title}</h2>
            <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              {p.body}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Common questions</h2>
        <div className="mt-6 divide-y" style={{ borderColor: "hsl(var(--buttercupp-border))" }}>
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group py-4"
              style={{ borderColor: "hsl(var(--buttercupp-border))" }}
            >
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium"
                style={{ color: "hsl(var(--buttercupp-fg))" }}
              >
                {f.q}
                <span
                  aria-hidden
                  className="text-lg transition-transform group-open:rotate-45"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  +
                </span>
              </summary>
              <p
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "hsl(var(--bc-muted))" }}
              >
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section
        className="mt-14 rounded-2xl border p-6 text-sm"
        style={{
          borderColor: "hsl(var(--buttercupp-border))",
          background: "hsl(var(--buttercupp-surface) / 0.6)",
          color: "hsl(var(--bc-muted))",
        }}
      >
        <p>
          If you spot something on this page that reads like an overclaim,
          please tell us. We would rather quietly correct a promise than
          quietly break one.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/legal/privacy"
            className="rounded-full border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: "hsl(var(--buttercupp-border))",
              color: "hsl(var(--buttercupp-fg))",
            }}
          >
            Full Privacy Policy
          </Link>
          <Link
            href="/legal/contact"
            className="rounded-full border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: "hsl(var(--buttercupp-accent-rose) / 0.4)",
              color: "hsl(var(--buttercupp-accent-rose))",
              background: "hsl(var(--buttercupp-accent-rose) / 0.08)",
            }}
          >
            Contact us
          </Link>
        </div>
      </section>
    </main>
  );
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
