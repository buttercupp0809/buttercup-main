"use client";

// Hero-style paywall. Matches the Figma "iPhone 17 - 1 / 2" pricing frame:
// a persona photo behind a black-to-transparent gradient, a five-star
// "Highly Rated" laurel badge, a hero headline, a monthly / yearly toggle
// with a Best Deal pill on yearly, one big amber CTA that reflects the
// live subscription price, and a "See all plans" link out to the full
// /billing surface.
//
// Renders in two visual modes:
//   - page mode (default): full-viewport takeover used by /upgrade.
//   - card mode (when `onClose` is provided): wraps the same layout in
//     the shared ModalCard chrome (rounded border, glass gradient bg,
//     rose+violet shadow, animated top hairline) so the takeover matches
//     every other modal in the product.
//
// The plan catalog + prices come from GET /billing/plans (never hardcoded)
// so the CTA label and the yearly-savings badge stay honest. The CTA calls
// POST /billing/subscribe with the existing sub_monthly / sub_yearly plans.

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackCta } from "@/lib/track-cta";
import type { BillingInterval, Plan, PlanConfig } from "@/app/(protected)/billing/BillingClient";
import { yearlySavingsPercent } from "@/app/(protected)/billing/BillingClient";

// Pass-mode plan keys, in display order (day / week / month). These match
// the one-time-pass rows returned by GET /billing/plans; the "passes"
// variant of the hero swaps the monthly/yearly cadence toggle for this
// three-way pass selector so a free user hitting the create-image gate
// can convert with the lowest-friction pass ($1 daily) without ever
// landing on the subscription cards.
// `as const` alone (without the widening `: readonly Plan[]` annotation)
// gives us the tuple literal type `readonly ["daily","weekly","monthly"]`
// so PassPlan resolves to the exact three keys, not the full Plan union.
const PASS_PLAN_ORDER = ["daily", "weekly", "monthly"] as const satisfies readonly Plan[];
type PassPlan = (typeof PASS_PLAN_ORDER)[number];

const PASS_LABEL: Record<PassPlan, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const PASS_UNIT: Record<PassPlan, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export interface PaywallHeroProps {
  // "subscription" (default): monthly/yearly toggle → sub_monthly / sub_yearly.
  // "passes": daily/weekly/monthly selector → one-time daily/weekly/monthly.
  // Used on the create-image gate so free users can buy a pass instead of
  // committing to a subscription just to unlock generation.
  variant?: "subscription" | "passes";
  initialInterval?: BillingInterval;
  // For variant="passes": which pass tab to pre-select. Defaults to
  // "monthly" (highest value, matches the "Best value" chip).
  initialPass?: PassPlan;
  heroImageSrc?: string;
  heroImageAlt?: string;
  seeAllHref?: string;
  headline?: string;
  seeAllLabel?: string;
  onClose?: () => void;
  closeAriaLabel?: string;
  contextLabel?: string;
}

export function PaywallHero({
  variant = "subscription",
  initialInterval = "year",
  initialPass = "monthly",
  heroImageSrc = "/personas/1.webp",
  heroImageAlt = "",
  seeAllHref = "/billing",
  headline = "Unlock the best version of your girlfriends",
  seeAllLabel = "See all plans",
  onClose,
  closeAriaLabel = "Close",
  contextLabel,
}: PaywallHeroProps) {
  const [plans, setPlans] = React.useState<PlanConfig[] | null>(null);
  const [interval, setInterval] = React.useState<BillingInterval>(initialInterval);
  const [passPlan, setPassPlan] = React.useState<PassPlan>(initialPass);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/billing/plans`, { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { plans: PlanConfig[] };
        if (!cancelled) setPlans(data.plans);
      } catch {
        if (!cancelled) setError("Could not load plans. Try refreshing the page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscription plans + savings
  const monthlyPlan = plans?.find((p) => p.plan === "sub_monthly");
  const yearlyPlan = plans?.find((p) => p.plan === "sub_yearly");
  const activeSubPlan = interval === "year" ? yearlyPlan : monthlyPlan;
  const savings = yearlySavingsPercent(monthlyPlan?.priceUsd, yearlyPlan?.priceUsd);

  // Pass plans keyed for O(1) lookup by the segmented selector
  const passPlansByKey = React.useMemo(() => {
    const map: Partial<Record<PassPlan, PlanConfig>> = {};
    for (const p of plans ?? []) {
      if (p.plan === "daily" || p.plan === "weekly" || p.plan === "monthly") {
        map[p.plan] = p;
      }
    }
    return map;
  }, [plans]);
  const activePassPlan = passPlansByKey[passPlan];

  const activePlan = variant === "passes" ? activePassPlan : activeSubPlan;

  const perMonth = activeSubPlan
    ? interval === "year"
      ? activeSubPlan.priceUsd / 12
      : activeSubPlan.priceUsd
    : null;

  const ctaLabel = React.useMemo(() => {
    if (pending) return "Redirecting...";
    if (variant === "passes") {
      if (!activePassPlan) return "Get pass";
      return `Get ${PASS_LABEL[passPlan]} Pass for $${activePassPlan.priceUsd}`;
    }
    if (perMonth == null) return "Unlock Unlimited Fun";
    return `Unlock Unlimited Fun for $${perMonth.toFixed(2)}/mo`;
  }, [pending, perMonth, variant, activePassPlan, passPlan]);

  async function onSubscribe() {
    if (!activePlan) return;
    trackCta(`paywall_hero_${activePlan.plan}`, "paywall_hero");
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/billing/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: activePlan.plan }),
      });
      const data = (await res.json()) as { checkoutUrl?: string; error?: string; message?: string };
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setError(`Checkout unavailable: ${data.error ?? "unknown"}${data.message ? ` - ${data.message}` : ""}`);
    } catch {
      setError("Could not start checkout. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const asCard = Boolean(onClose);

  const body = (
    <>
      {/* Plain <img> rather than next/image: heroImageSrc can be a signed
          CloudFront/S3 URL passed from a gallery lightbox, and next/image
          would reject it unless every possible hostname were pre-listed
          in next.config.ts (images.remotePatterns). The paywall is a
          rarely-rendered UI, so the optimizer's savings are negligible
          compared to the deployment-time risk of a broken paywall
          whenever CDN hostnames change. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={heroImageSrc}
        alt={heroImageAlt}
        className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-top"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, hsl(28 20% 6% / 0) 0%, hsl(28 20% 6% / 0.55) 55%, hsl(28 30% 3% / 0.95) 82%, hsl(28 30% 3% / 1) 100%)",
        }}
      />

      {onClose ? (
        <button
          type="button"
          aria-label={closeAriaLabel}
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
          data-testid="paywall-hero-close"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {contextLabel ? (
        <span
          className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs font-medium tracking-wide text-white backdrop-blur-md"
          data-testid="paywall-hero-context"
        >
          {contextLabel}
        </span>
      ) : null}

      <div className="relative flex flex-1 flex-col justify-end gap-6 px-6 pb-8 pt-16">
        <TrustBadge />

        <h1
          className="font-display text-center text-[1.75rem] font-medium leading-tight tracking-tight text-[hsl(var(--bc-fg))] sm:text-[2rem]"
          style={{ textWrap: "balance" }}
        >
          {headline}
        </h1>

        {variant === "passes" ? (
          <PassSelector
            value={passPlan}
            onChange={setPassPlan}
            plansByKey={passPlansByKey}
          />
        ) : (
          <IntervalToggle value={interval} onChange={setInterval} savings={savings} />
        )}

        <div className="flex flex-col gap-3">
          <Button
            variant="default"
            size="xl"
            onClick={onSubscribe}
            disabled={pending || !activePlan}
            className="w-full text-base"
            data-testid="paywall-hero-cta"
          >
            {ctaLabel}
          </Button>
          <Link
            href={seeAllHref}
            onClick={() => trackCta("paywall_hero_see_all", "paywall_hero")}
            className="mx-auto rounded-md px-2 py-1 text-[13px] font-light text-[hsl(var(--bc-fg))]/80 underline-offset-4 transition hover:text-[hsl(var(--bc-honey))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
            data-testid="paywall-hero-see-all"
          >
            {seeAllLabel}
          </Link>
          {error ? (
            <p role="alert" className="text-center text-xs" style={{ color: "hsl(var(--bc-danger))" }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );

  if (asCard) {
    // Card mode: matches the shared ModalCard chrome (rounded border, glass
    // gradient bg, layered rose+violet shadow, top gradient hairline, corner
    // glows) so this hero sits alongside every other modal in the product
    // without looking bespoke.
    return (
      <section
        data-testid="paywall-hero"
        // Card fills the viewport minus the ModalOverlay's own padding
        // (pt/pb max(1.25rem, safe-area) on mobile, py-8 on sm+) so the
        // paywall reads as the primary content instead of a small pill
        // floating in the middle of a big backdrop.
        className="relative isolate flex h-full min-h-[calc(100svh-2.5rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl shadow-2xl sm:min-h-[calc(100svh-4rem)]"
        style={{
          border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.25)",
          boxShadow:
            "0 40px 80px -20px hsl(var(--buttercupp-accent-rose) / 0.25), 0 20px 40px -20px hsl(var(--buttercupp-accent-violet) / 0.25), 0 8px 32px rgba(0, 0, 0, 0.6)",
          background: "hsl(var(--bc-bg))",
        }}
      >
        {/* Animated gradient hairline at the very top edge (matches ModalCard). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)), transparent)",
          }}
        />
        {body}
      </section>
    );
  }

  return (
    <section
      data-testid="paywall-hero"
      className="relative isolate mx-auto flex min-h-[100svh] w-full max-w-md flex-col overflow-hidden bg-[hsl(var(--bc-bg))] pt-safe pb-safe"
    >
      {body}
    </section>
  );
}

// Shared "Highly Rated" trust badge. Uses the brand SVG at
// /public/brand/high-rated.svg so a single asset update lands everywhere
// the paywall hero renders. The svg already carries the laurels, five
// gold stars, and the "Highly Rated / 1000+" copy.
function TrustBadge() {
  // Plain <img> instead of next/image: the asset is a trusted local SVG in
  // /public/brand/, and next/image rejects SVGs unless the app opts into
  // dangerouslyAllowSVG at the config level, which is a bigger security
  // surface than this single trust chip warrants.
  return (
    <div className="mx-auto">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/high-rated.svg"
        alt="Highly rated by over 1000 users"
        className="h-16 w-auto sm:h-20"
      />
    </div>
  );
}

// Segmented Daily / Weekly / Monthly selector for the "passes" hero
// variant. The Monthly tab wears a "Best value" pill (matches the pass
// tile treatment in BillingClient) so the highest-margin option pulls
// the eye first. Each tab shows its own price under the label so the
// user can compare at a glance without expanding tiles.
function PassSelector({
  value,
  onChange,
  plansByKey,
}: {
  value: PassPlan;
  onChange: (next: PassPlan) => void;
  plansByKey: Partial<Record<PassPlan, PlanConfig>>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pass duration"
      className="mx-auto flex w-full max-w-sm items-stretch gap-2"
      data-testid="paywall-pass-selector"
    >
      {PASS_PLAN_ORDER.map((key) => {
        const isActive = value === key;
        const isBest = key === "monthly";
        const plan = plansByKey[key];
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={
              "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] " +
              (isActive
                ? "border-[hsl(var(--bc-amber))] bg-[hsl(var(--bc-amber)/0.14)] text-[hsl(var(--bc-fg))]"
                : "border-white/15 bg-black/30 text-[hsl(var(--bc-fg))]/80 hover:border-white/30 hover:bg-black/40")
            }
            data-testid={`paywall-pass-${key}`}
          >
            {isBest ? (
              <span
                className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[hsl(var(--bc-amber))] px-2 py-[2px] text-[9px] font-bold uppercase tracking-wider text-[hsl(28_45%_9%)]"
                data-testid="paywall-pass-best-value"
              >
                Best value
              </span>
            ) : null}
            <span className="text-[11px] font-medium uppercase tracking-[0.14em]">
              {PASS_LABEL[key]}
            </span>
            <span className="font-display text-lg font-semibold leading-none">
              {plan ? `$${plan.priceUsd}` : "-"}
            </span>
            <span className="text-[10px] opacity-70">per {PASS_UNIT[key]}</span>
          </button>
        );
      })}
    </div>
  );
}

// Segmented Monthly / Yearly control with a Best Deal pill on the "yearly"
// side when the plans catalog actually surfaces a saving.
function IntervalToggle({
  value,
  onChange,
  savings,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  savings: number | null;
}) {
  const isYear = value === "year";
  const showSavings = savings != null && savings > 0;
  return (
    <div
      role="tablist"
      aria-label="Billing cadence"
      className="mx-auto flex items-center gap-3 text-[hsl(var(--bc-fg))]"
    >
      <button
        role="tab"
        type="button"
        aria-selected={!isYear}
        onClick={() => onChange("month")}
        className={
          "rounded-md px-1 py-1 text-sm font-light transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] " +
          (!isYear ? "text-[hsl(var(--bc-fg))]" : "text-[hsl(var(--bc-fg))]/60 hover:text-[hsl(var(--bc-fg))]")
        }
        data-testid="paywall-toggle-monthly"
      >
        Monthly
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={isYear}
        aria-label={isYear ? "Switch to monthly billing" : "Switch to yearly billing"}
        onClick={() => onChange(isYear ? "month" : "year")}
        className="relative inline-flex h-7 w-[50px] items-center rounded-full bg-[hsl(var(--bc-fg)/0.18)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        data-testid="paywall-toggle-switch"
      >
        <span
          aria-hidden
          className="inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-[0_1px_2px_hsl(28_40%_2%/0.4)] transition-transform duration-200 ease-[var(--ease-out)]"
          style={{ transform: isYear ? "translateX(26px)" : "translateX(2px)" }}
        />
      </button>

      <button
        role="tab"
        type="button"
        aria-selected={isYear}
        onClick={() => onChange("year")}
        className={
          "flex items-center gap-2 rounded-md px-1 py-1 text-sm font-light transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] " +
          (isYear ? "text-[hsl(var(--bc-fg))]" : "text-[hsl(var(--bc-fg))]/60 hover:text-[hsl(var(--bc-fg))]")
        }
        data-testid="paywall-toggle-yearly"
      >
        Yearly
        {showSavings ? (
          <span
            className="rounded-full bg-[hsl(var(--bc-amber))] px-2 py-[3px] text-[10px] font-bold tracking-wide text-[hsl(28_45%_9%)]"
            data-testid="paywall-best-deal"
          >
            Best Deal
          </span>
        ) : null}
      </button>
    </div>
  );
}
