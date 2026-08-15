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

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export interface PaywallModalProps {
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number;
  plans: TransportPaywallPlan[];
  // Called when the server-side entitlement flips active. Parent should
  // clear its `paywalled` state and re-enable the input.
  onResumed: () => void;
}

async function post(url: string, body: unknown): Promise<{ checkoutUrl?: string; error?: string }> {
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

export function PaywallModal({ scope, kind, used, limit, plans: plansFromEvent, onResumed }: PaywallModalProps) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fallbackPlans, setFallbackPlans] = React.useState<TransportPaywallPlan[] | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  const plans = plansFromEvent.length > 0 ? plansFromEvent : (fallbackPlans ?? []);

  // Fallback catalog fetch: the paywall frame should carry `plans`, but if
  // it ever arrives empty, fetch the public plan list directly.
  React.useEffect(() => {
    if (plansFromEvent.length > 0) return;
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
  }, [plansFromEvent]);

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
    setPending(plan);
    try {
      const r = await post(`${BACKEND_URL}/billing/subscribe`, { plan });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError(`Checkout unavailable: ${r.error ?? "unknown"}`);
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
  const headline =
    scope === "free_trial"
      ? `You have used all ${limit === -1 ? "your free" : limit} free messages`
      : kind === "chat"
      ? "You have used all your plan messages"
      : mediaRequiresPlan
      ? kind === "image"
        ? "Images require a plan"
        : "Videos require a plan"
      : kind === "image"
      ? "Your plan images are used up"
      : "Your plan videos are used up";

  const sub =
    scope === "free_trial"
      ? "Pick a pass to keep chatting. Cancel any time."
      : mediaRequiresPlan
      ? "Choose a pass below, or buy a token pack for one-off images and videos."
      : `You used ${used} of ${limit === -1 ? "unlimited" : limit}. Buy another pass to continue.`;

  const showBuyTokens = kind === "image" || kind === "video";

  if (dismissed) {
    return (
      <div
        data-testid="paywall-modal-dismissed-banner"
        role="status"
        className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-sm items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface, 210 40% 96%))",
          border: "1px solid hsl(var(--buttercupp-border, 214 32% 91%))",
        }}
      >
        <span>Upgrade to keep chatting.</span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          data-testid="paywall-reopen"
          className="font-semibold underline"
          style={{ color: "hsl(var(--buttercupp-accent-rose, 344 84% 71%))" }}
        >
          View plans
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      data-testid="paywall-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "hsl(var(--buttercupp-bg) / 0.8)" }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl rounded-2xl p-6 shadow-2xl"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface, 210 40% 96%))",
          border: "1px solid hsl(var(--buttercupp-border, 214 32% 91%))",
        }}
      >
        <h2 id="paywall-title" className="font-display text-2xl font-semibold">
          {headline}
        </h2>
        <p className="mt-1 text-sm opacity-80">{sub}</p>

        {error ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {plans
            .filter((p) => p.plan !== "free")
            .map((p) => (
              <div
                key={p.plan}
                data-testid={`paywall-plan-${p.plan}`}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "hsl(var(--buttercupp-surface-2, 210 40% 96%))",
                  border: "1px solid hsl(var(--buttercupp-border, 214 32% 91%))",
                }}
              >
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-base font-semibold">{p.label}</div>
                  <div className="text-sm opacity-80">${p.priceUsd}</div>
                </div>
                <div className="text-xs opacity-70">
                  {p.durationDays === 1 ? "1 day" : p.durationDays === 7 ? "7 days" : `${p.durationDays} days`}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs opacity-90">
                  <li>Chats: {p.chats === -1 ? "Unlimited" : p.chats}</li>
                  <li>Images: {p.images === -1 ? "Unlimited" : p.images}</li>
                  <li>Videos: {p.videos === -1 ? "Unlimited" : p.videos}</li>
                </ul>
                <button
                  type="button"
                  onClick={() => subscribe(p.plan)}
                  disabled={pending === p.plan}
                  data-testid={`paywall-buy-${p.plan}`}
                  className="mt-3 w-full rounded-md py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
                  style={{
                    background:
                      "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose, 344 84% 71%)), hsl(var(--buttercupp-accent-violet, 262 72% 68%)))",
                  }}
                >
                  {pending === p.plan ? "Redirecting..." : `Continue - $${p.priceUsd}`}
                </button>
              </div>
            ))}
        </div>

        {showBuyTokens ? (
          <a
            href="/billing#token-store"
            data-testid="paywall-buy-tokens-instead"
            className="mt-4 block text-center text-sm font-medium underline"
            style={{ color: "hsl(var(--buttercupp-accent-violet, 262 72% 68%))" }}
          >
            Buy tokens instead
          </a>
        ) : null}

        <p className="mt-4 text-[11px] opacity-60">
          After checkout, chat will resume automatically once payment confirms.
        </p>
      </div>
    </div>
  );
}
