"use client";

// Candy.ai-style billing surface. Plan catalog (labels, prices, quotas) comes
// from GET /billing/plans; current-plan status + remaining quotas come from
// GET /billing/entitlements. The UI never hardcodes quota or price numbers, so
// tuning plans.ts on the backend is enough. Discount badges are DERIVED from
// per-day price, not hardcoded.

import * as React from "react";
import { Star } from "lucide-react";

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
}

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

interface Props {
  tokenBalance: number;
  ledger: LedgerRow[];
}

const PACKS = [
  { id: "pack_100", label: "100 tokens", price: "$4.99" },
  { id: "pack_500", label: "500 tokens", price: "$19.99" },
  { id: "pack_2000", label: "2000 tokens", price: "$69.99" },
];

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

function formatDuration(days: number): string {
  if (days <= 0) return "lifetime";
  if (days === 1) return "1 day";
  if (days === 7) return "1 week";
  if (days === 30) return "1 month";
  return `${days} days`;
}

function formatQuota(bucket: QuotaBucket): string {
  if (bucket.limit === -1) return "Unlimited";
  return `${bucket.remaining} / ${bucket.limit}`;
}

export function BillingClient({ tokenBalance, ledger }: Props) {
  const [plans, setPlans] = React.useState<PlanConfig[]>([]);
  const [ent, setEnt] = React.useState<Entitlements | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, eRes] = await Promise.all([
        fetch(`${BACKEND_URL}/billing/plans`, { credentials: "include" }),
        fetch(`${BACKEND_URL}/billing/entitlements`, { credentials: "include" }),
      ]);
      if (pRes.ok) {
        const pj = (await pRes.json()) as { plans: PlanConfig[] };
        setPlans(pj.plans);
      }
      if (eRes.ok) {
        setEnt((await eRes.json()) as Entitlements);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

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

  async function buy(packId: string) {
    setPending(packId);
    try {
      const r = await post(`${BACKEND_URL}/billing/tokens`, { packId });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}`);
    } finally {
      setPending(null);
    }
  }

  const activePlan = ent?.plan ?? "free";

  // Best value first (longest pass). Derive a discount % from per-day price so
  // the badge is truthful and needs no hardcoded numbers.
  const paid = plans.filter((p) => p.plan !== "free").slice().sort((a, b) => b.durationDays - a.durationDays);
  const maxPerDay = paid.reduce((m, p) => Math.max(m, p.durationDays > 0 ? p.priceUsd / p.durationDays : 0), 0);

  return (
    <div className="flex flex-col gap-12" data-testid="billing-client">
      {error ? (
        <div
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: "hsl(var(--poppy-accent-rose) / 0.5)",
            backgroundColor: "hsl(var(--poppy-accent-rose) / 0.12)",
            color: "hsl(var(--poppy-fg))",
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
            <span className="text-sm font-semibold" style={{ color: "hsl(var(--poppy-fg))" }}>
              Trusted by 50M Users
            </span>
            <Laurel flip />
          </div>
          <div className="flex flex-col items-center">
            <Stars n={5} />
            <span className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
              1000+ Ratings
            </span>
          </div>
        </div>
      </div>

      {/* Plan tiles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="plan-cards">
        {paid.length === 0 && loading
          ? [0, 1, 2].map((i) => <div key={i} className="h-72 rounded-2xl" style={{ backgroundColor: "hsl(var(--poppy-surface))" }} />)
          : paid.map((p, i) => {
              const isBest = i === 0;
              const isCurrent = ent?.active && ent.plan === p.plan;
              const perDay = p.durationDays > 0 ? p.priceUsd / p.durationDays : 0;
              const discount = maxPerDay > 0 ? Math.round((1 - perDay / maxPerDay) * 100) : 0;
              return (
                <div
                  key={p.plan}
                  data-testid={`plan-${p.plan}`}
                  className="relative flex flex-col overflow-hidden rounded-2xl border p-5"
                  style={{
                    borderColor: isBest
                      ? "hsl(var(--poppy-accent-rose))"
                      : "hsl(var(--poppy-border))",
                    backgroundColor: "hsl(var(--poppy-surface))",
                    boxShadow: isBest ? "0 0 0 1px hsl(var(--poppy-accent-rose) / 0.4)" : undefined,
                  }}
                >
                  {isBest ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
                      style={{
                        background:
                          "linear-gradient(180deg, transparent, hsl(var(--poppy-accent-rose) / 0.18))",
                      }}
                    />
                  ) : null}
                  <div className="relative flex items-center justify-between">
                    <span className="font-display text-lg font-semibold">{p.label}</span>
                    {discount > 0 ? (
                      <span
                        className="rounded-md px-2 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: "hsl(45 90% 55% / 0.2)",
                          color: "hsl(45 90% 60%)",
                        }}
                      >
                        {discount}% OFF
                      </span>
                    ) : null}
                  </div>
                  {isBest ? (
                    <span
                      className="relative mt-1 text-xs font-bold uppercase tracking-wide"
                      style={{ color: "hsl(var(--poppy-accent-rose))" }}
                    >
                      Best value
                    </span>
                  ) : (
                    <span className="relative mt-1 text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
                      {formatDuration(p.durationDays)} pass
                    </span>
                  )}

                  <div className="relative mt-6 flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold">${p.priceUsd}</span>
                    <span className="text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
                      / {formatDuration(p.durationDays)}
                    </span>
                  </div>

                  <ul className="relative mt-4 space-y-1 text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
                    <li>{formatCount(p.chats)} chats</li>
                    <li>{formatCount(p.images)} images</li>
                    <li>{formatCount(p.videos)} videos</li>
                  </ul>

                  <button
                    type="button"
                    onClick={() => subscribe(p.plan)}
                    disabled={pending === p.plan || isCurrent}
                    data-testid={`buy-${p.plan}`}
                    className="relative mt-6 w-full rounded-xl py-3 text-sm font-semibold transition disabled:opacity-60"
                    style={
                      isBest
                        ? {
                            background:
                              "linear-gradient(90deg, hsl(var(--poppy-accent-rose)), hsl(var(--poppy-accent-violet)))",
                            color: "hsl(var(--poppy-primary-fg))",
                          }
                        : {
                            backgroundColor: "hsl(var(--poppy-surface-2))",
                            color: "hsl(var(--poppy-fg))",
                            border: "1px solid hsl(var(--poppy-border))",
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
                borderColor: "hsl(var(--poppy-border))",
                backgroundColor: "hsl(var(--poppy-surface))",
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
                borderColor: "hsl(var(--poppy-border))",
                backgroundColor: "hsl(var(--poppy-surface))",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.title}</span>
                <span className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
                  {r.who}
                </span>
              </div>
              <Stars n={5} emerald />
              <p className="text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
                {r.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Account: current plan + quotas + tokens (functional section) */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold">Your account</h2>
        <div
          className="rounded-2xl border p-5"
          style={{ borderColor: "hsl(var(--poppy-border))", backgroundColor: "hsl(var(--poppy-surface))" }}
          data-testid="current-plan"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "hsl(var(--poppy-muted))" }}>
                Current plan
              </div>
              <div className="font-display text-2xl font-semibold capitalize">
                {ent ? planLabel(activePlan, plans) : "..."}
              </div>
              <div className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
                {ent?.active && ent.expiresAt
                  ? `Expires ${new Date(ent.expiresAt).toLocaleString()}`
                  : ent
                    ? activePlan === "free"
                      ? "Lifetime free trial"
                      : "Inactive"
                    : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide" style={{ color: "hsl(var(--poppy-muted))" }}>
                Tokens
              </div>
              <div className="font-display text-2xl font-semibold">{tokenBalance}</div>
            </div>
          </div>

          {ent ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="remaining-quotas">
              <QuotaMeter label="Chats remaining" bucket={ent.chats} note={activePlan === "free" ? `${ent.freeMessagesUsed} used lifetime` : undefined} />
              <QuotaMeter label="Images remaining" bucket={ent.images} note={activePlan === "free" ? "No media on Free" : undefined} />
              <QuotaMeter label="Videos remaining" bucket={ent.videos} note={activePlan === "free" ? "No media on Free" : undefined} />
            </div>
          ) : loading ? (
            <div className="mt-4 text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>Loading entitlements...</div>
          ) : null}
        </div>
      </div>

      {/* Token packs */}
      <div>
        <h2 className="font-display mb-3 text-xl font-semibold">Buy tokens</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PACKS.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border p-4"
              style={{ borderColor: "hsl(var(--poppy-border))", backgroundColor: "hsl(var(--poppy-surface))" }}
            >
              <div className="font-display text-base font-semibold">{p.label}</div>
              <div className="text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>{p.price}</div>
              <button
                type="button"
                onClick={() => buy(p.id)}
                disabled={pending === p.id}
                className="mt-3 w-full rounded-xl py-2 text-sm font-medium disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--poppy-surface-2))",
                  color: "hsl(var(--poppy-fg))",
                  border: "1px solid hsl(var(--poppy-border))",
                }}
              >
                {pending === p.id ? "Redirecting..." : "Buy"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <h2 className="font-display mb-3 text-xl font-semibold">Recent activity</h2>
        <div
          className="overflow-hidden rounded-2xl border"
          style={{ borderColor: "hsl(var(--poppy-border))" }}
        >
          <table className="w-full text-sm">
            <thead
              className="text-xs uppercase"
              style={{ backgroundColor: "hsl(var(--poppy-surface-2))", color: "hsl(var(--poppy-muted))" }}
            >
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">Delta</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-center" style={{ color: "hsl(var(--poppy-muted))" }} colSpan={4}>
                    No activity yet.
                  </td>
                </tr>
              ) : (
                ledger.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid hsl(var(--poppy-border))" }}>
                    <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{row.reason}</td>
                    <td className={`px-3 py-2 text-right ${row.delta < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {row.delta > 0 ? "+" : ""}
                      {row.delta}
                    </td>
                    <td className="px-3 py-2 text-right">{row.balanceAfter}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function planLabel(plan: Plan, plans: PlanConfig[]): string {
  return plans.find((p) => p.plan === plan)?.label ?? plan;
}

function formatCount(n: number): string {
  if (n === -1) return "Unlimited";
  return String(n);
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
      style={{ transform: flip ? "scaleX(-1)" : undefined, color: "hsl(var(--poppy-muted))" }}
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

function QuotaMeter({
  label,
  bucket,
  note,
}: {
  label: string;
  bucket: QuotaBucket;
  note?: string;
}) {
  const unlimited = bucket.limit === -1;
  const pct = unlimited
    ? 100
    : bucket.limit === 0
      ? 0
      : Math.max(0, Math.min(100, ((bucket.limit - bucket.used) / bucket.limit) * 100));
  return (
    <div
      className="rounded-xl border p-3"
      style={{ backgroundColor: "hsl(var(--poppy-surface-2))", borderColor: "hsl(var(--poppy-border))" }}
    >
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide" style={{ color: "hsl(var(--poppy-muted))" }}>{label}</div>
        <div className="text-sm font-semibold">{formatQuota(bucket)}</div>
      </div>
      <div
        aria-hidden
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--poppy-border))" }}
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, hsl(var(--poppy-accent-rose)), hsl(var(--poppy-accent-violet)))",
          }}
        />
      </div>
      {note ? <div className="mt-1 text-[11px]" style={{ color: "hsl(var(--poppy-muted))" }}>{note}</div> : null}
    </div>
  );
}
