"use client";

// Client-side paywall gate for creation flows (character wizard, image
// generation, etc). Reads GET /api/billing/status once on mount to seed
// initial state, then polls GET /billing/entitlements every 5s while the
// paywall is up so a webhook-driven plan activation lifts the gate the
// moment it lands. Matches PaywallModal's behavior for the chat quota
// takeover so both surfaces feel like the same product.
//
// Visual layout mirrors PaywallModal (chat quota takeover):
//   - Wizard stays mounted underneath, dimmed to blur-sm and made non-
//     interactive so the "unlock to create this" story is grounded in
//     the actual create screen.
//   - PaywallHero (passes variant) mounts on top inside the shared
//     ModalOverlay chrome (backdrop blur, ambient rose+violet glow,
//     rose-tinted border, layered shadow) with a close (X) button.
//   - Dismissing the paywall collapses it to a small "Upgrade to
//     create" reopen pill, exactly like the chat paywall's dismissed
//     banner. The wizard remains dimmed underneath so the user cannot
//     silently proceed; only a server-confirmed plan activation
//     actually re-enables it.
//
// Backend still enforces every mutation regardless of the client gate
// (see backend/src/subscription/enforce.ts). If billing status fails
// to load we fail-open (wizard renders) so a transient network blip
// does not lock legitimate users out.

import * as React from "react";
import { PaywallHero } from "@/components/paywall/PaywallHero";
import { ModalOverlay } from "@/components/ui/Modal";
import { trackCta } from "@/lib/track-cta";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

interface BillingStatus {
  plan: string;
  status: string;
}

interface Entitlements {
  active: boolean;
  plan?: string;
}

async function fetchStatus(signal: AbortSignal): Promise<BillingStatus | null> {
  try {
    const res = await fetch("/api/billing/status", { cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}

// A viewer is "free" (needs a pass to proceed) when their plan is "free"
// AND their subscription status is not active. Matches the same predicate
// UpgradeModalProvider uses for the recurring nag so every gate agrees
// on who is behind the paywall.
function isFreeViewer(status: BillingStatus | null): boolean {
  if (!status) return false;
  return status.plan === "free" && status.status !== "active";
}

export interface CreateFlowPaywallProps {
  children: React.ReactNode;
  headline?: string;
  heroImageSrc?: string;
}

export function CreateFlowPaywall({
  children,
  headline,
  heroImageSrc,
}: CreateFlowPaywallProps) {
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [ready, setReady] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  // Seed the initial billing status from /api/billing/status (which reads
  // the same DB columns backend enforcement reads). One shot; the live
  // stream below is what actually flips the gate off after purchase.
  React.useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const s = await fetchStatus(ctrl.signal);
      setStatus(s);
      setReady(true);
    })();
    return () => ctrl.abort();
  }, []);

  const gated = ready && isFreeViewer(status);

  // Live entitlement polling while gated. Mirrors PaywallModal's chat-
  // quota poll (5s cadence) so the moment a webhook flips the user to
  // active, every paywall surface in the product dismisses in lock-step
  // instead of each having its own timing. Skipped entirely when the
  // gate is already off so paid users never poll.
  React.useEffect(() => {
    if (!gated) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/billing/entitlements`, { credentials: "include" });
        if (!r.ok) return;
        const ent = (await r.json()) as Entitlements;
        if (cancelled) return;
        if (ent.active) {
          // Server says the user is now paid; lift the gate by patching
          // status. React will re-render, `gated` flips to false, the
          // interval below unmounts, and the wizard becomes interactive.
          setStatus({ plan: ent.plan ?? "paid", status: "active" });
        }
      } catch {
        // Silent: transient blip should not throw the user out.
      }
    };
    const id = window.setInterval(tick, 5000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gated]);

  // ESC dismisses the modal to the reopen pill (matches chat paywall).
  React.useEffect(() => {
    if (!gated || dismissed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDismissed(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [gated, dismissed]);

  // Wizard always renders. While gated it stays fully visible and legible
  // (no blur, no dim) but non-interactive: `pointer-events-none` blocks
  // clicks / keys / drags on every descendant without visually altering
  // them, and `aria-hidden` keeps assistive tech from advertising the
  // disabled form as focusable. Dismissing the paywall keeps this
  // disabled state in place; there is intentionally no reopen pill or
  // secondary CTA so the create surface reads exactly like a locked
  // preview until the user pays.
  return (
    <>
      <div
        aria-hidden={gated}
        className={gated ? "pointer-events-none select-none" : undefined}
      >
        {children}
      </div>

      {gated && !dismissed ? (
        <ModalOverlay
          role="dialog"
          aria-modal="true"
          aria-label="Upgrade to create"
          data-testid="create-flow-paywall"
          backdropOpacity={0.7}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              trackCta("create_paywall_backdrop_dismiss", "create_paywall");
              setDismissed(true);
            }
          }}
        >
          <PaywallHero
            variant="passes"
            heroImageSrc={heroImageSrc}
            headline={headline ?? "Create your own version of her"}
            seeAllLabel="See all plans"
            onClose={() => {
              trackCta("create_paywall_close", "create_paywall");
              setDismissed(true);
            }}
            closeAriaLabel="Close"
          />
        </ModalOverlay>
      ) : null}
    </>
  );
}
