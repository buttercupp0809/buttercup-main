"use client";

// Blocking paywall modal. Rendered when the server emits a `paywall` frame
// on either transport. The plan catalog comes with the event (fallback to
// GET /billing/plans if the frame sent an empty array); we also poll
// GET /billing/entitlements while the modal is open so the UI resumes as
// soon as the checkout webhook flips `active` to true.
//
// This is a UI overlay only. The server is the source of truth for the
// gate; nothing on this page can bypass it. ESC hides the dialog chrome
// (a small reopen banner takes its place) but does NOT clear the parent's
// `paywalled` state, so the chat input stays disabled and the entitlement
// poll keeps running underneath. Only a server-confirmed entitlement flip
// (onResumed) actually re-enables the chat.

import * as React from "react";
import type { TransportPaywallPlan } from "@/lib/chat-transport";
import { ModalOverlay, ModalCard, ModalCloseButton } from "@/components/ui/Modal";
import { PASS_COPY } from "@/lib/pass-copy";
import { trackCta } from "@/lib/track-cta";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

// Mirror of BillingClient's HIDE_VIDEO_BENEFITS flag. Hides every "video"
// claim from the paywall modal: perk rows on each plan tile, the kind-based
// headline / subhead copy, and the video icon fallback. Server events with
// kind="video" still work, we simply render them as a generic media paywall
// so no "video" promise ever appears in the UI. Flip to false to restore.
const HIDE_VIDEO_BENEFITS = true;

export interface PaywallModalProps {
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number;
  plans: TransportPaywallPlan[];
  // Called when the server-side entitlement flips active. Parent should
  // clear its `paywalled` state and re-enable the input.
  onResumed: () => void;
  // Optional character avatar shown at the top of the modal for context.
  avatarUrl?: string | null;
  characterName?: string;
}

async function post(url: string, body: unknown): Promise<{ checkoutUrl?: string; error?: string; message?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

interface EntitlementsShape {
  active: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function PaywallModal({ scope, kind, used, limit, plans: plansFromEvent, onResumed, avatarUrl, characterName }: PaywallModalProps) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fallbackPlans, setFallbackPlans] = React.useState<TransportPaywallPlan[] | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  // Show the three one-time passes (daily / weekly / monthly) in the paywall
  // modal. Subscriptions live on /billing; the modal stays focused on the
  // lowest-friction entry point.
  const plans = React.useMemo(
    () =>
      (fallbackPlans ?? plansFromEvent).filter(
        (p) => p.plan === "daily" || p.plan === "weekly" || p.plan === "monthly",
      ),
    [plansFromEvent, fallbackPlans],
  );

  // Always fetch live prices from /billing/plans on mount. The paywall event
  // carries plan data but its prices come from the hardcoded PLANS constant,
  // not from the live Dodo API overlay that /billing/plans uses. We use the
  // event plans for the initial render (no loading flash) then replace with
  // fresh prices as soon as the fetch completes.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/billing/plans`, { credentials: "include" });
        if (!r.ok) return;
        const data = (await r.json()) as { plans: TransportPaywallPlan[] };
        if (!cancelled) setFallbackPlans(data.plans);
      } catch {
        // Leave fallbackPlans null; the modal still renders (with no cards)
        // rather than throwing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll entitlements every 5s while the modal is open. Bounded implicitly
  // by the component lifetime (unmounts when parent resumes). Server-side
  // entitlement is the only signal that flips the paywall off. Keeps
  // running even while `dismissed` is true so ESC never blocks the resume.
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/billing/entitlements`, { credentials: "include" });
        if (!r.ok) return;
        const ent = (await r.json()) as EntitlementsShape;
        if (!cancelled && ent.active) onResumed();
      } catch {
        // Silent: transient network blip should not throw the user out.
      }
    };
    const id = window.setInterval(tick, 5000);
    // First check immediately so a fast webhook does not wait 5s.
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [onResumed]);

  // ESC dismisses the dialog chrome to a read-only chat view; it does not
  // touch the parent's `paywalled` state, so the input stays disabled.
  React.useEffect(() => {
    if (dismissed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDismissed(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissed]);

  // Focus trap: move focus into the dialog on open/reopen, and keep Tab /
  // Shift+Tab cycling within it.
  React.useEffect(() => {
    if (dismissed) return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables()[0];
    first?.focus();

    function onKeydown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    node.addEventListener("keydown", onKeydown);
    return () => node.removeEventListener("keydown", onKeydown);
  }, [dismissed]);

  async function subscribe(plan: string) {
    trackCta(`paywall_${plan}_pass`, "paywall_modal");
    setPending(plan);
    try {
      const r = await post(`${BACKEND_URL}/billing/subscribe`, { plan });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}${r.message ? ` — ${r.message}` : ""}`);
    } finally {
      setPending(null);
    }
  }

  // Copy is scope/kind-aware:
  //  - free_trial: the lifetime free-message allowance ran out.
  //  - plan_quota + kind=chat: an active plan's chat quota ran out.
  //  - plan_quota + kind=image/video, used===0: the user has never had a
  //    plan that grants this media type ("requires a plan").
  //  - plan_quota + kind=image/video, used>0: an active plan's media quota
  //    for that kind ran out.
  const mediaRequiresPlan = scope === "plan_quota" && kind !== "chat" && used === 0;

  // Split the headline into a body + emphasized token so the token can
  // wear the honey to amber brand gradient without hardcoding brittle string
  // slicing on every branch.
  // When HIDE_VIDEO_BENEFITS is on, a kind="video" event still triggers the
  // paywall (backend contract unchanged) but we render neutral media copy so
  // the word "video" never appears. When the flag is off, the historic
  // video-specific copy is used as-is.
  const kindLabelPlural = HIDE_VIDEO_BENEFITS && kind === "video" ? "media" : kind === "image" ? "images" : "videos";
  const kindLabelCap = HIDE_VIDEO_BENEFITS && kind === "video" ? "Media" : kind === "image" ? "Images" : "Videos";

  const headlineParts: { body: string; token?: string } =
    scope === "free_trial"
      ? {
          body: "You have used all",
          token: `${limit === -1 ? "your free" : limit} free messages`,
        }
      : kind === "chat"
      ? { body: "You have used all", token: "your plan messages" }
      : mediaRequiresPlan
      ? { body: kindLabelCap, token: "require a plan" }
      : { body: `Your plan ${kindLabelPlural}`, token: "are used up" };

  const sub =
    scope === "free_trial"
      ? "Pick a pass and keep the story going. Cancel any time, no drama."
      : mediaRequiresPlan
      ? HIDE_VIDEO_BENEFITS
        ? "Grab a pass, or buy a token pack for one-off images."
        : "Grab a pass, or buy a token pack for one-off images and videos."
      : `You used ${used} of ${limit === -1 ? "unlimited" : limit}. One more pass and you are back in the moment.`;

  const showBuyTokens = kind === "image" || kind === "video";

  // Monthly pass has the lowest per-day cost → "Best value" ribbon.
  // No "Most popular" ribbon for passes; best-value is the only badge.
  const highlightIndex = -1;
  const bestValueIndex = plans.findIndex((p) => p.plan === "monthly");
  const kindIcon =
    kind === "image"
      ? <ImageIcon className="h-6 w-6" />
      : kind === "video"
        ? HIDE_VIDEO_BENEFITS
          ? <SparkleIcon className="h-6 w-6" />
          : <VideoIcon className="h-6 w-6" />
        : <SparkleIcon className="h-6 w-6" />;

  if (dismissed) {
    return (
      <div
        data-testid="paywall-modal-dismissed-banner"
        role="status"
        className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-sm items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg backdrop-blur"
        style={{
          backgroundColor: "hsl(var(--bc-surface) / 0.85)",
          border: "1px solid hsl(var(--bc-amber) / 0.35)",
          color: "hsl(var(--bc-fg))",
        }}
      >
        <span className="flex items-center gap-1.5">
          <SparkleIcon className="h-3.5 w-3.5" style={{ color: "hsl(var(--bc-amber))" }} />
          Upgrade to keep chatting
        </span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          data-testid="paywall-reopen"
          className="rounded-full px-3 py-1 text-xs font-semibold text-[hsl(28_45%_9%)] shadow-sm"
          style={{
            backgroundImage: "var(--bc-gradient-brand-h)",
          }}
        >
          View plans
        </button>
      </div>
    );
  }

  return (
    <ModalOverlay
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      data-testid="paywall-modal"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <ModalCard ref={dialogRef} size="xl" style={{ maxWidth: "56rem" }}>
        <ModalCloseButton onClick={() => setDismissed(true)} ariaLabel="Minimize" />

        <div className="relative px-5 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
          {avatarUrl && (
            <div className="mb-4 flex justify-center">
              <img
                src={avatarUrl}
                alt={characterName ?? "Character"}
                className="h-16 w-16 rounded-full object-cover object-top shadow-lg"
                style={{ border: "2px solid hsl(var(--bc-amber) / 0.5)" }}
              />
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <div
              className="relative flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--bc-amber) / 0.25), hsl(var(--bc-honey) / 0.25))",
                border: "1px solid hsl(var(--bc-amber) / 0.4)",
                color: "hsl(var(--bc-amber))",
                boxShadow: "0 8px 24px -6px hsl(var(--bc-amber) / 0.45)",
              }}
            >
              {kindIcon}
              <span
                aria-hidden
                className="absolute inset-0 -z-10 animate-pulse rounded-2xl"
                style={{ background: "hsl(var(--bc-amber) / 0.2)", filter: "blur(14px)" }}
              />
            </div>

            <h2
              id="paywall-title"
              className="font-display mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
              style={{ color: "hsl(var(--buttercupp-fg))" }}
            >
              {headlineParts.body}{" "}
              {headlineParts.token ? (
                <span
                  style={{
                    backgroundImage: "var(--bc-gradient-brand-h)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {headlineParts.token}
                </span>
              ) : null}
            </h2>
            <p
              className="mt-3 max-w-lg text-pretty text-sm sm:text-base"
              style={{ color: "hsl(var(--buttercupp-muted))" }}
            >
              {sub}
            </p>
          </div>

          {error ? (
            <div
              className="mt-5 rounded-xl border px-3 py-2 text-xs"
              style={{
                borderColor: "hsl(var(--bc-warning) / 0.4)",
                background: "hsl(var(--bc-warning) / 0.08)",
                color: "hsl(36 98% 78%)",
              }}
            >
              {error}
            </div>
          ) : null}

          {/* Three pass tiles: single column on mobile, 3-column from md+. */}
          <div className="mx-auto mt-10 grid w-full max-w-3xl grid-cols-1 gap-8 md:mt-8 md:grid-cols-3 md:gap-4">
            {plans.map((p, i) => {
              const copy = PASS_COPY[p.plan];
              const highlight = i === highlightIndex;
              const bestValue = i === bestValueIndex;
              const perDay = p.priceUsd / p.durationDays;
              const perDayText = p.durationDays > 1 ? `~$${perDay.toFixed(2)}/day` : null;

              return (
                <div
                  key={p.plan}
                  data-testid={`paywall-plan-${p.plan}`}
                  className="relative flex flex-col rounded-2xl p-4 transition"
                  style={{
                    background: highlight
                      ? "linear-gradient(160deg, hsl(var(--bc-amber) / 0.12), hsl(var(--bc-honey) / 0.12))"
                      : "hsl(var(--bc-surface-2) / 0.7)",
                    border: highlight
                      ? "1px solid hsl(var(--bc-amber) / 0.55)"
                      : "1px solid hsl(var(--bc-border))",
                    boxShadow: highlight
                      ? "0 20px 40px -12px hsl(var(--bc-amber) / 0.35)"
                      : "none",
                  }}
                >
                  {highlight ? <Ribbon label="Most popular" /> : null}
                  {bestValue ? <Ribbon label="Best value" variant="honey" /> : null}

                  {/* Tagline + price */}
                  <div>
                    <p className="text-sm font-semibold leading-snug" style={{ color: "hsl(var(--buttercupp-fg))" }}>
                      {copy?.tagline ?? p.label}
                    </p>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
                        ${p.priceUsd}
                      </span>
                      <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                        / {p.durationDays === 1 ? "day" : p.durationDays === 7 ? "week" : "month"}
                      </span>
                    </div>
                    {copy?.perDayLabel ? (
                      <div className="mt-0.5 text-[10px]" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                        {copy.perDayLabel}
                      </div>
                    ) : perDayText ? (
                      <div className="mt-0.5 text-[10px]" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                        {perDayText}
                      </div>
                    ) : null}
                  </div>

                  {/* Custom bullets — pb-4 guarantees space above the mt-auto button */}
                  <ul className="mt-4 space-y-1.5 pb-4 text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    {(copy?.bullets ?? []).map((line) => (
                      <li key={line} className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0" style={{ color: "hsl(var(--bc-amber))" }}>✓</span>
                        {line}
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => subscribe(p.plan)}
                    disabled={pending === p.plan}
                    data-testid={`paywall-buy-${p.plan}`}
                    className="group mt-auto flex w-full items-center justify-center gap-1.5 rounded-[var(--bc-radius)] py-3 text-sm font-semibold text-[hsl(28_45%_9%)] shadow-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                    style={{
                      backgroundImage: "var(--bc-gradient-brand-h)",
                      boxShadow: bestValue
                        ? "0 10px 24px -6px hsl(var(--bc-amber) / 0.55)"
                        : "0 6px 16px -6px hsl(var(--bc-amber) / 0.4)",
                    }}
                  >
                    {pending === p.plan ? (
                      <>
                        <SpinnerIcon className="h-3.5 w-3.5" />
                        Redirecting...
                      </>
                    ) : (
                      <>
                        {copy?.buttonText ?? `Continue for $${p.priceUsd}`}
                        <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {showBuyTokens ? (
            <div className="mt-6 flex justify-center">
              <a
                href="/billing#token-store"
                data-testid="paywall-buy-tokens-instead"
                onClick={() => trackCta("paywall_buy_tokens", "paywall_modal")}
                className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition hover:opacity-80"
                style={{
                  borderColor: "hsl(var(--bc-amber) / 0.5)",
                  color: "hsl(var(--bc-honey))",
                  background: "hsl(var(--bc-amber) / 0.08)",
                }}
              >
                <CoinIcon className="h-3.5 w-3.5" />
                Buy tokens instead
              </a>
            </div>
          ) : null}

          <div
            className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t pt-5 text-[11px]"
            style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }}
          >
            <TrustPill icon={<LockIcon className="h-3 w-3" />} label="Secure checkout" />
            <TrustPill icon={<HeartIcon className="h-3 w-3" />} label="Cancel anytime" />
            <TrustPill icon={<BoltIcon className="h-3 w-3" />} label="Instant access" />
          </div>

          <p
            className="mt-4 text-center text-[11px]"
            style={{ color: "hsl(var(--buttercupp-muted) / 0.8)" }}
          >
            After checkout, your chat resumes automatically once payment confirms.
          </p>
        </div>
      </ModalCard>
    </ModalOverlay>
  );
}

function Ribbon({ label, variant = "amber" }: { label: string; variant?: "amber" | "honey" }) {
  return (
    <div
      className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(28_45%_9%)] shadow-md"
      style={{
        backgroundImage:
          variant === "honey"
            ? "linear-gradient(90deg, hsl(var(--bc-honey)), hsl(36 100% 63%))"
            : "var(--bc-gradient-brand-h)",
        boxShadow: "0 6px 14px -4px hsl(var(--bc-amber) / 0.5)",
      }}
    >
      {label}
    </div>
  );
}

function PerkRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2" style={{ color: "hsl(var(--buttercupp-muted))" }}>
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md"
          style={{
            background: "hsl(var(--bc-amber) / 0.15)",
            color: "hsl(var(--bc-amber))",
          }}
          aria-hidden
        >
          {icon}
        </span>
        {label}
      </span>
      <span className="font-medium" style={{ color: "hsl(var(--buttercupp-fg))" }}>
        {value}
      </span>
    </li>
  );
}

function TrustPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"
      style={{
        borderColor: "hsl(var(--buttercupp-border))",
        background: "hsl(var(--buttercupp-surface-2) / 0.6)",
      }}
    >
      <span style={{ color: "hsl(var(--bc-amber))" }}>{icon}</span>
      {label}
    </span>
  );
}

// Icon set (inline SVG, no runtime lib dependency). Kept minimal, 24x24
// viewBox, stroke-based so they inherit currentColor gracefully.
function iconProps(className?: string): React.SVGProps<SVGSVGElement> {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  } as React.SVGProps<SVGSVGElement>;
}

function SparkleIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg {...iconProps(className)} style={style}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    </svg>
  );
}
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  );
}
function VideoIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
    </svg>
  );
}
function LockIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function HeartIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M20.8 6.6a5.5 5.5 0 0 0-9-1.8L12 5l-.2-.2a5.5 5.5 0 1 0-7.8 7.8l7.3 7.5a1 1 0 0 0 1.4 0l7.3-7.5a5.5 5.5 0 0 0 .8-6z" />
    </svg>
  );
}
function BoltIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}
function CoinIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 10h4a2 2 0 0 1 0 4h-4M9 14h5" />
    </svg>
  );
}
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)} className={`${className ?? ""} animate-spin`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
