"use client";

// Blocking chat-quota paywall. Rendered when the server emits a `paywall`
// frame on either transport (free-trial exhausted, plan quota exhausted for
// chats / images / videos). The visual surface is the shared PaywallHero
// (matches Figma "iPhone 17 - 1"): the persona the user is chatting with
// fills the entire viewport behind the CTA, a Monthly/Yearly toggle picks
// the cadence, and a single amber CTA sends the user to Dodo checkout.
// "See all plans" links to /billing for the full pass + subscription
// catalog.
//
// This is a UI overlay only. The server is the source of truth for the
// gate; nothing on this page can bypass it. ESC hides the takeover to a
// small reopen pill but does NOT clear the parent's `paywalled` state, so
// the chat input stays disabled and the entitlement poll keeps running
// underneath. Only a server-confirmed entitlement flip (onResumed) actually
// re-enables the chat.

import * as React from "react";
import { createPortal } from "react-dom";
import type { TransportPaywallPlan } from "@/lib/chat-transport";
import { PaywallHero } from "@/components/paywall/PaywallHero";
import { ModalOverlay } from "@/components/ui/Modal";
import { trackCta } from "@/lib/track-cta";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export interface PaywallModalProps {
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number;
  // Plan list from the server-side paywall event. Retained for backward
  // compatibility; PaywallHero fetches live prices from /billing/plans so we
  // do not need to re-forward this list into the hero.
  plans: TransportPaywallPlan[];
  onResumed: () => void;
  avatarUrl?: string | null;
  characterName?: string;
}

interface EntitlementsShape {
  active: boolean;
}

export function PaywallModal({
  avatarUrl,
  characterName,
  onResumed,
  // Silence unused warnings; the values are part of the transport contract
  // and may drive analytics in a follow-up.
  scope: _scope,
  kind: _kind,
  used: _used,
  limit: _limit,
  plans: _plans,
}: PaywallModalProps) {
  const [dismissed, setDismissed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Poll entitlements every 5s while the paywall is open. The server is the
  // only signal that flips it off; a webhook flip re-enables chat instantly.
  // Keeps running even while dismissed so ESC never blocks the resume.
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
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [onResumed]);

  // ESC dismisses the takeover to a compact reopen pill. Does NOT clear the
  // parent's paywalled state.
  React.useEffect(() => {
    if (dismissed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDismissed(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissed]);

  if (!mounted) return null;

  if (dismissed) {
    return createPortal(
      <div
        data-testid="paywall-modal-dismissed-banner"
        role="status"
        className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit max-w-sm items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg backdrop-blur md:bottom-4"
        style={{
          backgroundColor: "hsl(var(--bc-surface) / 0.85)",
          border: "1px solid hsl(var(--bc-amber) / 0.35)",
          color: "hsl(var(--bc-fg))",
        }}
      >
        <span>Upgrade to keep chatting</span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          data-testid="paywall-reopen"
          className="rounded-full px-3 py-1 text-xs font-semibold text-[hsl(28_45%_9%)] shadow-sm"
          style={{ backgroundImage: "var(--bc-gradient-brand-h)" }}
        >
          View plans
        </button>
      </div>,
      document.body,
    );
  }

  // Modal-card takeover. ModalOverlay carries the shared backdrop chrome
  // (blur, ambient rose+violet glow, safe-area padding) so this paywall
  // reads as part of the same modal family as every other overlay in the
  // product. PaywallHero renders itself as a card when onClose is set,
  // matching ModalCard's rounded border, glass shadow, and top hairline.
  return (
    <ModalOverlay
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade to keep chatting"
      data-testid="paywall-modal"
      backdropOpacity={0.7}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          trackCta("paywall_modal_backdrop_dismiss", "paywall_modal");
          setDismissed(true);
        }
      }}
    >
      <PaywallHero
        heroImageSrc={avatarUrl ?? "/personas/1.webp"}
        heroImageAlt={characterName ?? ""}
        contextLabel={characterName ?? undefined}
        onClose={() => {
          trackCta("paywall_modal_close", "paywall_modal");
          setDismissed(true);
        }}
        closeAriaLabel="Minimize"
      />
    </ModalOverlay>
  );
}
