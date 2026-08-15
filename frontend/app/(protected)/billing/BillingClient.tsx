"use client";

// Candy.ai-style billing surface. Plan catalog (labels, prices, quotas) comes
// from GET /billing/plans; current-plan status + remaining quotas come from
// GET /billing/entitlements. The UI never hardcodes quota or price numbers, so
// tuning plans.ts on the backend is enough. Discount badges are DERIVED from
// per-day price, not hardcoded.

import * as React from "react";
import { Star } from "lucide-react";
import { TokenStore } from "./TokenStore";

type Plan = "free" | "daily" | "weekly" | "monthly";

interface PlanConfig {
  plan: Plan;
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
}

interface QuotaBucket {
  limit: number;
  used: number;
  remaining: number;
}

interface Entitlements {
  plan: Plan;
  active: boolean;
  expiresAt: string | null;
  chats: QuotaBucket;
  images: QuotaBucket;
  videos: QuotaBucket;
  freeMessagesUsed: number;
}

// Emoji-forward premium benefits, per the reference. Emoji are an explicit
// design choice here (they match the Candy.ai look the product is after).
const BENEFITS = [
  { emoji: "✨", label: "Create your own companions" },
  { emoji: "🔥", label: "Generate 18+ videos" },
  { emoji: "🎬", label: "Full live-action experience" },
  { emoji: "💬", label: "Unlimited text messages" },
  { emoji: "🪙", label: "Token packs for images and video" },
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

function formatQuota(bucket: QuotaBucket | undefined): string {
  if (!bucket) return "-";
  if (bucket.limit === -1) return "Unlimited";
  return `${bucket.remaining} left`;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface BillingClientProps {
  // Pre-highlights a card when arriving from /upgrade?plan=weekly or a
  // paywall CTA. Purely presentational; the server still enforces everything.
  highlightPlan?: Plan;
}

export function BillingClient({ highlightPlan }: BillingClientProps) {
  const [plans, setPlans] = React.useState<PlanConfig[] | null>(null);
  const [ent, setEnt] = React.useState<Entitlements | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refreshEntitlements = React.useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/billing/entitlements`, { credentials: "include" });
      if (res.ok) setEnt((await res.json()) as Entitlements);
    } catch {
      // Entitlements are best-effort here; the server still enforces everything.
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/billing/plans`, { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { plans: PlanConfig[] };
          setPlans(data.plans);
        }
      } catch {
        setError("Could not load plans. Try refreshing the page.");
      }
    })();
    void refreshEntitlements();
  }, [refreshEntitlements]);

  async function subscribe(plan: Plan) {
    setPending(plan);
    setError(null);
    try {
      const r = await post(`${BACKEND_URL}/billing/subscribe`, { plan });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}`);
    } finally {
      setPending(null);
    }
  }

  const paidPlans = (plans ?? []).filter((p) => p.plan !== "free");
  // "Best value" = lowest price-per-day; discount badges are computed
  // relative to the highest per-day rate among the paid plans, never
  // hardcoded percentages.
  const perDay = (p: PlanConfig) => (p.durationDays > 0 ? p.priceUsd / p.durationDays : p.priceUsd);
  const maxPerDay = paidPlans.length ? Math.max(...paidPlans.map(perDay)) : 0;
  const bestPlan = paidPlans.length
    ? paidPlans.reduce((best, p) => (perDay(p) < perDay(best) ? p : best), paidPlans[0])
    : null;

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

      {/* Current-plan status panel: driven entirely by GET /billing/entitlements. */}
      <CurrentPlanPanel ent={ent} plans={plans} />

      {/* Plan tiles, driven by GET /billing/plans */}
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-3" data-testid="plan-cards">
        {paidPlans.map((p) => {
          const isCurrent = ent?.active && ent.plan === p.plan;
          const isBest = bestPlan?.plan === p.plan;
          const discount = maxPerDay > 0 ? Math.round((1 - perDay(p) / maxPerDay) * 100) : 0;
          const isHighlighted = highlightPlan === p.plan;
          return (
            <div
              key={p.plan}
              data-testid={`plan-${p.plan}`}
              className="relative flex min-h-[340px] flex-col overflow-hidden rounded-3xl border p-6"
              style={{
                borderColor:
                  isBest || isHighlighted
                    ? "hsl(var(--buttercupp-accent-rose))"
                    : "hsl(var(--buttercupp-border))",
                backgroundColor: "hsl(var(--buttercupp-surface))",
              }}
            >
              {isBest ? (
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
                {discount > 0 ? (
                  <span
                    className="rounded-lg px-2.5 py-1 text-xs font-extrabold text-black"
                    style={{ background: "linear-gradient(180deg, hsl(48 96% 62%), hsl(40 92% 52%))" }}
                  >
                    {discount}% OFF
                  </span>
                ) : null}
              </div>

              {isBest ? (
                <span
                  className="relative mt-1 text-sm font-extrabold uppercase tracking-wide"
                  style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
                >
                  Best value
                </span>
              ) : null}

              <div className="relative mt-auto pt-8">
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-5xl font-extrabold tracking-tight">${p.priceUsd}</span>
                  <span className="text-base" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    / {p.durationDays === 1 ? "day" : p.durationDays === 7 ? "week" : `${p.durationDays} days`}
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                  <li>Chats: {p.chats === -1 ? "Unlimited" : p.chats}</li>
                  <li>Images: {p.images === -1 ? "Unlimited" : p.images}</li>
                  <li>Videos: {p.videos === -1 ? "Unlimited" : p.videos}</li>
                </ul>
              </div>

              <button
                type="button"
                onClick={() => subscribe(p.plan)}
                disabled={pending === p.plan || isCurrent}
                data-testid={`buy-${p.plan}`}
                className="relative mt-5 w-full rounded-2xl py-3.5 text-base font-bold transition disabled:opacity-60"
                style={
                  isBest
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
                {pending === p.plan ? "Redirecting..." : isCurrent ? "Current plan" : "Continue"}
              </button>
            </div>
          );
        })}
        {!plans ? (
          <div
            className="col-span-full rounded-2xl border p-6 text-center text-sm"
            style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }}
          >
            Loading plans...
          </div>
        ) : null}
      </div>

      {/* Token store: one-time token pack purchases, separate from duration passes. */}
      <TokenStore />

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

function CurrentPlanPanel({ ent, plans }: { ent: Entitlements | null; plans: PlanConfig[] | null }) {
  if (!ent) {
    return (
      <div
        className="mx-auto w-full max-w-4xl rounded-2xl border p-5 text-sm"
        style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }}
        data-testid="current-plan-panel"
      >
        Loading your plan...
      </div>
    );
  }

  const planLabel = plans?.find((p) => p.plan === ent.plan)?.label ?? (ent.plan === "free" ? "Free" : ent.plan);

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl border p-5"
      style={{ borderColor: "hsl(var(--buttercupp-border))", backgroundColor: "hsl(var(--buttercupp-surface))" }}
      data-testid="current-plan-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-semibold">{planLabel}</span>
          {ent.active ? (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.18)",
                color: "hsl(var(--buttercupp-accent-rose))",
              }}
            >
              Active
            </span>
          ) : null}
        </div>
        {ent.active && ent.expiresAt ? (
          <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            Renews or expires {formatExpiry(ent.expiresAt)}
          </span>
        ) : null}
      </div>

      {ent.active ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <QuotaMeter label="Chats" bucket={ent.chats} />
          <QuotaMeter label="Images" bucket={ent.images} />
          <QuotaMeter label="Videos" bucket={ent.videos} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          <span>
            Chats left: {Math.max(0, ent.chats.limit - ent.freeMessagesUsed)} of {ent.chats.limit}
          </span>
          <span>No media on Free</span>
        </div>
      )}
    </div>
  );
}

function QuotaMeter({ label, bucket }: { label: string; bucket: QuotaBucket }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ color: "hsl(var(--buttercupp-muted))" }}>{label}</span>
      <span className="font-semibold">{formatQuota(bucket)}</span>
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
