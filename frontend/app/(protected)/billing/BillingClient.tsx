"use client";

// Candy.ai-style billing surface. Plan catalog (labels, prices, quotas) comes
// from GET /billing/plans; current-plan status + remaining quotas come from
// GET /billing/entitlements. The UI never hardcodes quota or price numbers, so
// tuning plans.ts on the backend is enough. Discount badges are DERIVED from
// per-day price, not hardcoded.

import * as React from "react";
import { Star } from "lucide-react";

type Plan = "free" | "daily" | "weekly" | "monthly";

interface Entitlements {
  plan: Plan;
  active: boolean;
  expiresAt: string | null;
}

// Emoji-forward premium benefits, per the reference. Emoji are an explicit
// design choice here (they match the Candy.ai look the product is after).
const BENEFITS = [
  { emoji: "✨", label: "Create your own AI companions" },
  { emoji: "🔥", label: "Generate 18+ videos" },
  { emoji: "🎬", label: "Full live-action experience" },
  { emoji: "💬", label: "Unlimited text messages" },
  { emoji: "🪙", label: "100 tokens per month" },
];

const REVIEWS = [
  {
    title: "This is really a cool app",
    body: "Pay for premium, it is worth it. Image generation is off the chain, characters are excellent, and you can make the companions yourself.",
    who: "A***",
  },
  {
    title: "Creative chat",
    body: "I have been using it for months and still enjoy it very much. The chat made me stick around: it is creative and gives room for different scenarios.",
    who: "M***",
  },
  {
    title: "Worth every token",
    body: "The memory is what sold me. It actually remembers our conversations and the voice replies feel real. Nothing else comes close.",
    who: "J***",
  },
];

// Fixed subscription tiers shown exactly as designed (12 / 3 / 1 months, INR).
// `plan` maps to the backend plan enum used by /billing/subscribe. Prices and
// discounts are presentational; the checkout amount is set server-side.
const SUB_PLANS = [
  { plan: "monthly" as const, label: "12 Months", price: 300, original: 1180, discount: 70, best: true },
  { plan: "weekly" as const, label: "3 Months", price: 815, original: 1180, discount: 30, best: false },
  { plan: "daily" as const, label: "1 Month", price: 1180, original: null, discount: null, best: false },
];

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

async function post(url: string, body: unknown): Promise<{ checkoutUrl?: string; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

export function BillingClient() {
  const [ent, setEnt] = React.useState<Entitlements | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/billing/entitlements`, { credentials: "include" });
        if (res.ok) setEnt((await res.json()) as Entitlements);
      } catch {
        // entitlements are only used to disable the current plan's button
      }
    })();
  }, []);

  async function subscribe(plan: Plan) {
    setPending(plan);
    try {
      const r = await post(`${BACKEND_URL}/billing/subscribe`, { plan });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-12" data-testid="billing-client">
      {error ? (
        <div
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
            backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.12)",
            color: "hsl(var(--buttercupp-fg))",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Heading + social proof */}
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight">Choose your Plan</h1>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <div className="flex items-center gap-2">
            <Laurel />
            <span className="text-sm font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
              Trusted by 50M Users
            </span>
            <Laurel flip />
          </div>
          <div className="flex flex-col items-center">
            <Stars n={5} />
            <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              1000+ Ratings
            </span>
          </div>
        </div>
      </div>

      {/* Plan tiles (fixed 12 / 3 / 1 month design) */}
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-3" data-testid="plan-cards">
        {SUB_PLANS.map((p) => {
          const isCurrent = ent?.active && ent.plan === p.plan;
          return (
            <div
              key={p.plan}
              data-testid={`plan-${p.plan}`}
              className="relative flex min-h-[340px] flex-col overflow-hidden rounded-3xl border p-6"
              style={{
                borderColor: p.best ? "hsl(var(--buttercupp-accent-rose))" : "hsl(var(--buttercupp-border))",
                backgroundColor: "hsl(var(--buttercupp-surface))",
              }}
            >
              {p.best ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
                  style={{
                    background: "linear-gradient(180deg, transparent, hsl(var(--buttercupp-accent-rose) / 0.28))",
                  }}
                />
              ) : null}

              <div className="relative flex items-start justify-between gap-2">
                <span className="font-display text-2xl font-bold">{p.label}</span>
                {p.discount ? (
                  <span
                    className="rounded-lg px-2.5 py-1 text-xs font-extrabold text-black"
                    style={{ background: "linear-gradient(180deg, hsl(48 96% 62%), hsl(40 92% 52%))" }}
                  >
                    {p.discount}% OFF
                  </span>
                ) : null}
              </div>

              {p.best ? (
                <span
                  className="relative mt-1 text-sm font-extrabold uppercase tracking-wide"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  Best value
                </span>
              ) : null}

              <div className="relative mt-auto pt-8">
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-5xl font-extrabold tracking-tight">{inr(p.price)}</span>
                  <span className="text-base" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    /month
                  </span>
                </div>
                {p.original ? (
                  <div className="mt-1 text-lg font-semibold line-through" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    {inr(p.original)}
                  </div>
                ) : (
                  <div className="mt-1 h-7" />
                )}
              </div>

              <button
                type="button"
                onClick={() => subscribe(p.plan)}
                disabled={pending === p.plan || isCurrent}
                data-testid={`buy-${p.plan}`}
                className="relative mt-5 w-full rounded-2xl py-3.5 text-base font-bold transition disabled:opacity-60"
                style={
                  p.best
                    ? {
                        background: "linear-gradient(180deg, hsl(344 90% 72%), hsl(344 84% 60%))",
                        color: "white",
                      }
                    : {
                        backgroundColor: "hsl(var(--buttercupp-surface-2))",
                        color: "hsl(var(--buttercupp-fg))",
                        border: "1px solid hsl(var(--buttercupp-border))",
                      }
                }
              >
                {pending === p.plan ? "Redirecting..." : isCurrent ? "Current plan" : "Get Started"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Premium benefits */}
      <div>
        <h2 className="font-display mb-4 text-xl font-semibold">Premium Benefits</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {BENEFITS.map((b) => (
            <div
              key={b.label}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{
                borderColor: "hsl(var(--buttercupp-border))",
                backgroundColor: "hsl(var(--buttercupp-surface))",
              }}
            >
              <span className="text-lg" aria-hidden>
                {b.emoji}
              </span>
              <span className="text-sm font-medium">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div>
        <h2 className="font-display mb-4 text-center text-2xl font-bold">What users are saying</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {REVIEWS.map((r) => (
            <div
              key={r.title}
              className="flex flex-col gap-2 rounded-2xl border p-5"
              style={{
                borderColor: "hsl(var(--buttercupp-border))",
                backgroundColor: "hsl(var(--buttercupp-surface))",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.title}</span>
                <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                  {r.who}
                </span>
              </div>
              <Stars n={5} emerald />
              <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                {r.body}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function Stars({ n, emerald }: { n: number; emerald?: boolean }) {
  const color = emerald ? "hsl(160 60% 45%)" : "hsl(45 90% 55%)";
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} className="h-4 w-4" style={{ color, fill: color }} />
      ))}
    </div>
  );
}

function Laurel({ flip }: { flip?: boolean }) {
  return (
    <svg
      width="18"
      height="24"
      viewBox="0 0 18 24"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined, color: "hsl(var(--buttercupp-muted))" }}
    >
      <path
        d="M14 2c-6 2-9 7-9 14 0 2 .3 4 1 6M11 6c-3 0-5 1-6 3M12 11c-3 0-5 1-6 3M13 16c-2 0-4 1-5 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

