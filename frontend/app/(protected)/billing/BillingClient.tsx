"use client";

// Candy.ai-style billing surface. Plan catalog (labels, prices, quotas) comes
// from GET /billing/plans; current-plan status + remaining quotas come from
// GET /billing/entitlements. The UI never hardcodes quota or price numbers, so
// tuning plans.ts on the backend is enough. Discount badges are DERIVED from
// per-day price, not hardcoded.

import * as React from "react";
import {
  Star,
  Check,
  Sparkles,
  Flame,
  Clapperboard,
  MessageCircle,
  Coins,
  Mic,
  type LucideIcon,
} from "lucide-react";
import { TokenStore } from "./TokenStore";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { PASS_COPY, type PassCopy } from "@/lib/pass-copy";
import { trackCta } from "@/lib/track-cta";

// Feature flag: hide the pay-as-you-go token packs section for now. Kept as
// a trivially flippable constant (and TokenStore.tsx is preserved) so the
// section can be re-enabled with a one-line change once the pricing story
// for packs is finalized.
const SHOW_TOKEN_PACKS = false;

// Feature flag: hide every "video" / "clip" claim from the billing surface
// (subscription tiles, pass tiles, paywall promo copy, premium benefits, and
// the live current-plan quota pill). Kept as a single constant so the promise
// of video features can be re-enabled with a one-line flip once the
// generation quality bar is met. The backend contract is unchanged: the
// server still returns video quotas from /billing/plans and /billing/entitlements;
// we simply filter them out of the render layer here.
const HIDE_VIDEO_BENEFITS = true;

// Any benefit label matching this pattern is dropped from the "Premium
// benefits" grid while HIDE_VIDEO_BENEFITS is on. Also applied to the token
// packs subtitle. Exported for tests.
export const HIDDEN_BENEFIT_PATTERN = /video|clips?/i;

export function filterHiddenBenefits<T extends { label: string }>(items: readonly T[]): T[] {
  if (!HIDE_VIDEO_BENEFITS) return [...items];
  return items.filter((b) => !HIDDEN_BENEFIT_PATTERN.test(b.label));
}

type BillingTab = "subscription" | "passes";

// Heading shown on each one-time pass tile, keyed by plan. Falls back to the
// plan's own label for any plan not listed here.
const PASS_TITLE: Record<string, string> = {
  daily: "Daily pass",
  weekly: "Weekly pass",
  monthly: "Monthly pass",
};

const BILLING_TABS: ReadonlyArray<TabItem<BillingTab>> = [
  { value: "passes", label: "Passes", testId: "billing-tab-passes" },
  { value: "subscription", label: "Subscription", testId: "billing-tab-subscription" },
];

// Subscription plans that should land the user on the subscription tab
// when arriving via a highlighted plan link (e.g. /upgrade?plan=sub_monthly).
const SUB_PLAN_SET: ReadonlySet<Plan> = new Set(["sub_monthly", "sub_yearly"]);


export type Plan =
  | "free"
  | "daily"
  | "weekly"
  | "monthly"
  | "sub_monthly"
  | "sub_yearly";

export type BillingInterval = "month" | "year";

export interface PlanConfig {
  plan: Plan;
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
  // Optional flag from the backend. True for auto-renewing subscription
  // products; undefined / false for one-time duration passes.
  recurring?: boolean;
  billingInterval?: BillingInterval;
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

// Premium benefits list. Each perk renders a lucide-react icon in the warm
// accent, matching the icon convention used across the product.
export const BENEFITS: { icon: LucideIcon; label: string }[] = [
  { icon: Sparkles, label: "Create your own companions" },
  { icon: Flame, label: "Generate 18+ videos" },
  { icon: Clapperboard, label: "Full live-action experience" },
  { icon: MessageCircle, label: "Unlimited text messages" },
  { icon: Coins, label: "Token packs for images and video" },
  { icon: Mic, label: "Expressive voice replies" },
];

const VISIBLE_BENEFITS = filterHiddenBenefits(BENEFITS);

export const REVIEWS = [
  {
    title: "Characters that feel real",
    body: "The one I built remembers a small joke I made three weeks ago and brought it up on a slow Sunday. That is when I stopped comparing this to other apps.",
    who: "N***",
  },
  {
    title: "Best image gen so far",
    body: "I asked for a rainy noir scene and got exactly the mood I described, not a generic stock render. Being able to guide the pose and lighting through chat is the part I did not expect to love.",
    who: "S***",
  },
  {
    title: "Roleplay that respects the plot",
    body: "Long roleplay sessions actually keep continuity here. The voice replies land the tone, and prompts do not reset the story every few turns. Feels like writing with a partner.",
    who: "K***",
  },
];

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

async function post(url: string, body: unknown): Promise<{ checkoutUrl?: string; error?: string; message?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

function planDurationLabel(days: number): string {
  if (days === 1) return "day";
  if (days === 7) return "week";
  if (days === 30) return "month";
  return `${days} days`;
}

// Cosmetic short interval label for recurring subscriptions ("/mo", "/yr").
function intervalShort(interval: BillingInterval | undefined, days: number): string {
  if (interval === "month") return "mo";
  if (interval === "year") return "yr";
  return planDurationLabel(days);
}

// Returns a rounded percent saved on the yearly plan versus 12x monthly, or
// null when either input is missing / non-positive. Exported for tests so
// the badge math stays honest.
export function yearlySavingsPercent(
  monthlyPrice: number | undefined,
  yearlyPrice: number | undefined,
): number | null {
  if (!monthlyPrice || !yearlyPrice) return null;
  if (monthlyPrice <= 0 || yearlyPrice <= 0) return null;
  const twelveMonths = monthlyPrice * 12;
  if (twelveMonths <= yearlyPrice) return null;
  return Math.round((1 - yearlyPrice / twelveMonths) * 100);
}

// Splits the plan catalog into the one-time "Passes" and the recurring
// "Subscriptions" sections. Exported so tests can exercise the split
// without rendering the component.
export function splitPlans(plans: PlanConfig[]): { passes: PlanConfig[]; subs: PlanConfig[] } {
  const paid = plans.filter((p) => p.plan !== "free");
  return {
    passes: paid.filter((p) => !p.recurring),
    subs: paid.filter((p) => p.recurring),
  };
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
  const [activeTab, setActiveTab] = React.useState<BillingTab>(
    highlightPlan && SUB_PLAN_SET.has(highlightPlan) ? "subscription" : "passes",
  );

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
    trackCta(`billing_${plan}`, "billing_page");
    setPending(plan);
    setError(null);
    try {
      const r = await post(`${BACKEND_URL}/billing/subscribe`, { plan });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}${r.message ? ` — ${r.message}` : ""}`);
    } finally {
      setPending(null);
    }
  }

  const { passes: passPlans, subs: subPlans } = splitPlans(plans ?? []);
  // "Best value" (Passes only) = lowest price-per-day among duration passes;
  // discount badges are computed relative to the highest per-day rate in
  // the same group, never hardcoded percentages. Subscriptions get their
  // own "Save X%" badge derived from yearly vs 12x monthly.
  const perDay = (p: PlanConfig) => (p.durationDays > 0 ? p.priceUsd / p.durationDays : p.priceUsd);
  const maxPassPerDay = passPlans.length ? Math.max(...passPlans.map(perDay)) : 0;
  const bestPassPlan = passPlans.length
    ? passPlans.reduce((best, p) => (perDay(p) < perDay(best) ? p : best), passPlans[0])
    : null;
  const monthlySubPrice = subPlans.find((p) => p.billingInterval === "month")?.priceUsd;
  const yearlySubPrice = subPlans.find((p) => p.billingInterval === "year")?.priceUsd;
  const yearlySavings = yearlySavingsPercent(monthlySubPrice, yearlySubPrice);

  return (
    <div className="flex flex-col gap-5 sm:gap-6" data-testid="billing-client">
      {error ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{
            borderColor: "hsl(var(--bc-amber) / 0.5)",
            backgroundColor: "hsl(var(--bc-amber) / 0.1)",
            color: "hsl(var(--bc-fg))",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Single-row header that fuses three previously separate strips:
          trust badge (left), Passes / Subscription tab strip (center),
          and the live current-plan pill (right). Symmetric
          `grid-cols-[1fr_auto_1fr]` gives both side cells equal width
          so the tabs (auto-sized middle cell) sit perfectly centered
          regardless of how much content the trust badge or plan pill
          carry — the wide "Monthly Subscription · Active · 4985 chats"
          pill in the premium state and the empty state both keep the
          tabs on the exact viewport center. Falls back to a stack on
          very narrow screens where each cell wraps to its own row. */}
      <div
        className="grid grid-cols-1 items-center gap-3 rounded-2xl border px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4"
        style={{
          borderColor: "hsl(var(--bc-border))",
          backgroundColor: "hsl(var(--bc-surface-2) / 0.55)",
        }}
      >
        <div className="flex justify-center sm:justify-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/high-rated.svg"
            alt="Highly rated by over 1000 users"
            className="h-9 w-auto sm:h-11"
          />
        </div>
        <div className="flex justify-center">
          <Tabs<BillingTab>
            value={activeTab}
            onValueChange={setActiveTab}
            items={BILLING_TABS}
            ariaLabel="Billing options"
          />
        </div>
        <div className="flex min-w-0 justify-center sm:justify-end">
          <CurrentPlanPill ent={ent} plans={plans} />
        </div>
      </div>

      {/* Passes: one-time duration passes. Section heading intentionally
          omitted; the tab strip already carries the "Passes" label so a
          second title/subtitle only added noise. */}
      {activeTab === "passes" ? (
        <div data-testid="passes-section">
          <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-3" data-testid="plan-cards">
            {passPlans.map((p) => {
              const copy = PASS_COPY[p.plan];
              const isCurrent = ent?.active && ent.plan === p.plan;
              const isBest = bestPassPlan?.plan === p.plan;
              const isHighlighted = highlightPlan === p.plan;
              const promoted = isBest || isHighlighted;
              return (
                <div
                  key={p.plan}
                  data-testid={`plan-${p.plan}`}
                  className="group relative flex min-h-[380px] flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1"
                  style={{
                    borderColor: promoted
                      ? "hsl(var(--bc-amber) / 0.7)"
                      : "hsl(var(--bc-border))",
                    backgroundColor: "hsl(var(--bc-surface) / 0.85)",
                    backdropFilter: "blur(12px)",
                    boxShadow: promoted
                      ? "0 20px 60px -24px hsl(var(--bc-amber) / 0.5)"
                      : "0 8px 32px rgba(0, 0, 0, 0.35)",
                  }}
                >
                  {promoted ? (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                            "radial-gradient(30rem 20rem at 50% 120%, hsl(var(--bc-amber) / 0.28), transparent 65%)",
                        }}
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-8 -top-px h-px"
                        style={{
                          background:
                            "linear-gradient(90deg, transparent, hsl(var(--bc-amber) / 0.8), transparent)",
                        }}
                      />
                    </>
                  ) : null}

                  {isBest ? (
                    <span
                      className="relative mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-[0_4px_16px_-6px_hsl(var(--bc-amber)/0.6)]"
                      style={{
                        background: "var(--bc-gradient-brand-v)",
                        color: "hsl(28 45% 9%)",
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: "hsl(28 45% 9% / 0.85)" }}
                        aria-hidden
                      />
                      Best value
                    </span>
                  ) : null}

                  {/* Pass name heading + tagline */}
                  <div className="relative">
                    <p
                      className="font-display text-2xl font-bold leading-tight tracking-tight"
                      style={{ color: "hsl(var(--bc-fg))" }}
                    >
                      {PASS_TITLE[p.plan] ?? p.label}
                    </p>
                    {copy?.tagline ? (
                      <p
                        className="mt-1 text-sm font-medium leading-snug"
                        style={{ color: "hsl(var(--bc-muted))" }}
                      >
                        {copy.tagline}
                      </p>
                    ) : null}
                  </div>

                  {/* Price */}
                  <div className="relative mt-3">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-5xl font-extrabold tracking-tight">${p.priceUsd}</span>
                      <span className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
                        / {planDurationLabel(p.durationDays)}
                      </span>
                    </div>
                    {copy?.perDayLabel ? (
                      <div className="mt-0.5 text-[11px]" style={{ color: "hsl(var(--bc-muted))" }}>
                        {copy.perDayLabel}
                      </div>
                    ) : null}
                  </div>

                  {/* Custom bullets */}
                  <ul className="relative mt-6 space-y-2 text-sm">
                    {copy
                      ? copy.bullets.map((line) => (
                          <FeatureLine key={line}>{line}</FeatureLine>
                        ))
                      : null}
                  </ul>

                  <div className="relative mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => subscribe(p.plan)}
                      disabled={pending === p.plan || isCurrent}
                      data-testid={`buy-${p.plan}`}
                      className="w-full rounded-2xl py-3.5 text-base font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-60"
                      style={
                        promoted
                          ? {
                              background: "var(--bc-gradient-brand-v)",
                              color: "hsl(28 45% 9%)",
                              boxShadow: "0 12px 30px -12px hsl(var(--bc-amber) / 0.6)",
                            }
                          : {
                              backgroundColor: "hsl(var(--bc-surface-2))",
                              color: "hsl(var(--bc-fg))",
                              border: "1px solid hsl(var(--bc-border))",
                            }
                      }
                    >
                      {pending === p.plan
                        ? "Redirecting..."
                        : isCurrent
                          ? "Current plan"
                          : (copy?.buttonText ?? "Continue")}
                    </button>
                  </div>
                </div>
              );
            })}
            {!plans ? (
              <div
                className="col-span-full rounded-2xl border p-6 text-center text-sm"
                style={{ borderColor: "hsl(var(--bc-border))", color: "hsl(var(--bc-muted))" }}
              >
                Loading plans...
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Subscriptions: recurring monthly / yearly. Second tab. Section
          heading intentionally omitted; the tab strip already carries the
          "Subscription" label so a second title/subtitle only added noise. */}
      {activeTab === "subscription" && subPlans.length > 0 ? (
        <div data-testid="subscriptions-section">
          <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-2" data-testid="subscription-cards">
            {subPlans.map((p) => {
              const isCurrent = ent?.active && ent.plan === p.plan;
              const isHighlighted = highlightPlan === p.plan;
              const savings = p.billingInterval === "year" ? yearlySavings : null;
              const isMostPopular = p.billingInterval === "month";
              const promoted = isMostPopular || isHighlighted;
              return (
                <div
                  key={p.plan}
                  data-testid={`plan-${p.plan}`}
                  className="group relative flex min-h-[380px] flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1"
                  style={{
                    borderColor: promoted
                      ? "hsl(var(--bc-amber) / 0.7)"
                      : "hsl(var(--bc-border))",
                    backgroundColor: "hsl(var(--bc-surface) / 0.85)",
                    backdropFilter: "blur(12px)",
                    boxShadow: promoted
                      ? "0 20px 60px -24px hsl(var(--bc-amber) / 0.5)"
                      : "0 8px 32px rgba(0, 0, 0, 0.35)",
                  }}
                >
                  {promoted ? (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                            "radial-gradient(30rem 20rem at 50% 120%, hsl(var(--bc-amber) / 0.28), transparent 65%)",
                        }}
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-8 -top-px h-px"
                        style={{
                          background:
                            "linear-gradient(90deg, transparent, hsl(var(--bc-amber) / 0.8), transparent)",
                        }}
                      />
                    </>
                  ) : null}

                  {isMostPopular ? (
                    <span
                      data-testid="most-popular-badge"
                      className="relative mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-[0_4px_16px_-6px_hsl(var(--bc-amber)/0.6)]"
                      style={{
                        background: "var(--bc-gradient-brand-v)",
                        color: "hsl(28 45% 9%)",
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: "hsl(28 45% 9% / 0.85)" }}
                        aria-hidden
                      />
                      Most popular
                    </span>
                  ) : (
                    <span
                      className="relative mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider"
                      style={{
                        color: "hsl(var(--bc-amber))",
                        backgroundColor: "hsl(var(--bc-amber) / 0.15)",
                      }}
                    >
                      Auto-renew
                    </span>
                  )}

                  <div className="relative flex items-start justify-between gap-3">
                    <span className="font-display text-2xl font-bold tracking-tight">{p.label}</span>
                    {savings != null && savings > 0 ? (
                      <span
                        data-testid="yearly-savings-badge"
                        className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-extrabold"
                        style={{ background: "var(--bc-gradient-brand-v)", color: "hsl(28 45% 9%)" }}
                      >
                        Save {savings}%
                      </span>
                    ) : null}
                  </div>

                  <div className="relative mt-2">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-5xl font-extrabold tracking-tight">${p.priceUsd}</span>
                      <span className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
                        /{intervalShort(p.billingInterval, p.durationDays)}
                      </span>
                    </div>
                    {p.billingInterval === "year" && p.priceUsd > 0 ? (
                      <div className="mt-0.5 text-[11px]" style={{ color: "hsl(var(--bc-muted))" }}>
                        ≈ ${(p.priceUsd / 12).toFixed(2)} per month, billed yearly
                      </div>
                    ) : null}
                  </div>

                  <ul className="relative mt-6 space-y-2 text-sm">
                    <FeatureLine>Chats: {p.chats === -1 ? "Unlimited" : p.chats} per month</FeatureLine>
                    <FeatureLine>Images: {p.images === -1 ? "Unlimited" : p.images} per month</FeatureLine>
                    {HIDE_VIDEO_BENEFITS ? null : (
                      <FeatureLine>Videos: {p.videos === -1 ? "Unlimited" : p.videos} per month</FeatureLine>
                    )}
                    <FeatureLine>Voice replies + memory</FeatureLine>
                    <FeatureLine>Priority generation</FeatureLine>
                  </ul>

                  <div className="relative mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => subscribe(p.plan)}
                      disabled={pending === p.plan || isCurrent}
                      data-testid={`buy-${p.plan}`}
                      className="w-full rounded-2xl py-3.5 text-base font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-60"
                      style={
                        promoted
                          ? {
                              background: "var(--bc-gradient-brand-v)",
                              color: "hsl(28 45% 9%)",
                              boxShadow: "0 12px 30px -12px hsl(var(--bc-amber) / 0.6)",
                            }
                          : {
                              backgroundColor: "hsl(var(--bc-surface-2))",
                              color: "hsl(var(--bc-fg))",
                              border: "1px solid hsl(var(--bc-border))",
                            }
                      }
                    >
                      {pending === p.plan ? "Redirecting..." : isCurrent ? "Current plan" : "Subscribe"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {SHOW_TOKEN_PACKS ? (
        <>
          <SectionDivider />
          <div>
            <SectionHeading
              title="Token"
              accent="packs"
              chipLabel="Tokens"
              chipVariant="honey"
              subtitle={
                HIDE_VIDEO_BENEFITS
                  ? "Pay-as-you-go credits for extra images on top of any plan."
                  : "Pay-as-you-go credits for extra images and videos on top of any plan."
              }
            />
            <TokenStore />
          </div>
        </>
      ) : null}

      {/* Premium benefits */}
      <div>
        <div className="mb-5 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Premium{" "}
            <span
              style={{
                background: "var(--bc-gradient-brand-h)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              benefits
            </span>
          </h2>
          <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
            Everything unlocked on a paid plan.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VISIBLE_BENEFITS.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.label}
                className="buttercupp-glass flex items-center gap-3 rounded-2xl px-4 py-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--bc-amber)/0.35)]"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--bc-honey) / 0.15), hsl(var(--bc-amber) / 0.15))",
                  }}
                  aria-hidden
                >
                  <Icon
                    className="h-5 w-5 shrink-0"
                    aria-hidden
                    style={{ color: "hsl(var(--bc-honey))" }}
                  />
                </span>
                <span className="text-sm font-medium">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reviews */}
      <div>
        <div className="mb-5 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            What users are{" "}
            <span
              style={{
                background: "var(--bc-gradient-brand-h)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              saying
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {REVIEWS.map((r) => (
            <div
              key={r.title}
              className="buttercupp-glass flex flex-col gap-2 rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.title}</span>
                <span className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                  {r.who}
                </span>
              </div>
              <Stars n={5} />
              <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
                {r.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ChipVariant = "amber" | "honey";

// Category chip colors. All chrome now pulls from the amber/honey brand ramp so
// Subscriptions, Passes, and Token packs stay within one warm family; the
// background is a low-opacity tint of the same hue.
const CHIP_STYLES: Record<ChipVariant, { color: string; background: string; border: string }> = {
  amber: {
    color: "hsl(var(--bc-amber))",
    background: "hsl(var(--bc-amber) / 0.14)",
    border: "hsl(var(--bc-amber) / 0.35)",
  },
  honey: {
    color: "hsl(var(--bc-honey))",
    background: "hsl(var(--bc-honey) / 0.14)",
    border: "hsl(var(--bc-honey) / 0.35)",
  },
};

function SectionHeading({
  title,
  accent,
  subtitle,
  chipLabel,
  chipVariant = "amber",
}: {
  title: string;
  accent: string;
  subtitle?: string;
  chipLabel?: string;
  chipVariant?: ChipVariant;
}) {
  const chip = chipLabel ? CHIP_STYLES[chipVariant] : null;
  return (
    <div className="mb-5 flex flex-col items-center text-center">
      {chip ? (
        <span
          className="mb-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em]"
          style={{
            color: chip.color,
            backgroundColor: chip.background,
            borderColor: chip.border,
          }}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: chip.color }}
          />
          {chipLabel}
        </span>
      ) : null}
      <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {title}{" "}
        <span
          style={{
            background: "var(--bc-gradient-brand-h)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {accent}
        </span>
      </h2>
      {subtitle ? (
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function SectionDivider() {
  return (
    <div
      aria-hidden
      className="mx-auto h-px w-full max-w-4xl"
      style={{
        background:
          "linear-gradient(90deg, transparent, hsl(var(--bc-border)) 30%, hsl(var(--bc-border)) 70%, transparent)",
      }}
    />
  );
}

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: "hsl(var(--bc-amber))" }}
      />
      <span style={{ color: "hsl(var(--bc-fg))" }}>{children}</span>
    </li>
  );
}

// Compact single-line status pill that lives on the top header row next
// to the trust / ratings strip. It carries the live plan label plus a
// compact remaining-quota readout ("chats N · images N · videos N") so
// users can see what they still have without scrolling. On Free it falls
// back to "X of 10 chats left". Kept small on purpose so the pricing
// tiles remain the hero above the fold.
function formatBucketRemaining(bucket: QuotaBucket): string {
  if (bucket.limit === -1) return "unlimited";
  return String(Math.max(0, bucket.remaining));
}

function CurrentPlanPill({ ent, plans }: { ent: Entitlements | null; plans: PlanConfig[] | null }) {
  if (!ent) return null;
  const planLabel =
    plans?.find((p) => p.plan === ent.plan)?.label ?? (ent.plan === "free" ? "Free" : ent.plan);
  const isFree = ent.plan === "free" || !ent.active;
  const freeChatsLeft = Math.max(0, ent.chats.limit - ent.freeMessagesUsed);
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2 text-xs"
      data-testid="current-plan-pill"
    >
      <span
        className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border px-3 py-1.5 text-center"
        style={{
          borderColor: "hsl(var(--bc-border))",
          backgroundColor: "hsl(var(--bc-surface) / 0.6)",
          color: "hsl(var(--bc-fg))",
        }}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "hsl(var(--bc-muted))" }}
        >
          Current plan
        </span>
        <span className="font-semibold">{planLabel}</span>
        {ent.active ? (
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: "hsl(var(--bc-success) / 0.18)",
                color: "hsl(var(--bc-success))",
              }}
            >
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: "hsl(var(--bc-success))" }}
              />
              Active
            </span>
            <span
              aria-hidden
              className="hidden h-3 w-px sm:inline-block"
              style={{ backgroundColor: "hsl(var(--bc-border))" }}
            />
            <PlanStat label="chats" value={formatBucketRemaining(ent.chats)} />
            <PlanStat label="images" value={formatBucketRemaining(ent.images)} />
            {HIDE_VIDEO_BENEFITS ? null : (
              <PlanStat label="videos" value={formatBucketRemaining(ent.videos)} />
            )}
          </>
        ) : isFree ? (
          <span style={{ color: "hsl(var(--bc-muted))" }}>
            <strong style={{ color: "hsl(var(--bc-fg))" }}>{freeChatsLeft}</strong> of{" "}
            {ent.chats.limit} chats left
          </span>
        ) : null}
      </span>
    </div>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-semibold" style={{ color: "hsl(var(--bc-fg))" }}>
        {value}
      </span>
      <span className="text-[10px]" style={{ color: "hsl(var(--bc-muted))" }}>
        {label}
      </span>
    </span>
  );
}

function Stars({ n }: { n: number }) {
  // Rating stars pull the brand amber so the trust bar and review cards stay
  // inside the warm palette.
  const color = "hsl(var(--bc-amber))";
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} className="h-4 w-4" style={{ color, fill: color }} />
      ))}
    </div>
  );
}

