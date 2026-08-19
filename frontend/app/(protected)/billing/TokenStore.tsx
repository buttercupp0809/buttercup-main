"use client";

// One-time token pack purchases. The catalog comes from GET /billing/token-packs
// (backend/src/http/billing.ts, backed by TOKEN_PACKS in
// payments/webhooks/shared.ts) so credits/price are never hardcoded here.
// "Buy" redirects to a provider-hosted checkout; the credit itself is written
// by the webhook (transaction.completed + tokenPackId -> refundTokens) via
// the TokenLedger. This component only ever READS the resulting balance from
// GET /billing/status, it never writes it.

import * as React from "react";
import { Coins } from "lucide-react";

interface TokenPack {
  id: string;
  credits: number;
  label: string;
  priceUsd: number;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

// sessionStorage marker so the resume poll only runs when THIS browser tab
// actually started a purchase, not on every page load.
const PENDING_KEY = "buttercupp:pendingTokenPurchaseBalance";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 30; // ~2 minutes, bounded so an abandoned checkout does not poll forever

async function post(url: string, body: unknown): Promise<{ checkoutUrl?: string; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

export function TokenStore() {
  const [packs, setPacks] = React.useState<TokenPack[] | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fetchBalance = React.useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { tokenBalance: number };
      setBalance(data.tokenBalance);
      return data.tokenBalance;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/billing/token-packs`, { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { packs: TokenPack[] };
          setPacks(data.packs);
        }
      } catch {
        setError("Could not load token packs.");
      }
    })();
    void fetchBalance();
  }, [fetchBalance]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (raw === null) return;
    const baseline = Number(raw);
    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;

    const tick = async () => {
      attempts += 1;
      const current = await fetchBalance();
      if (cancelled) return;
      if (current !== null && current > baseline) {
        window.sessionStorage.removeItem(PENDING_KEY);
        return;
      }
      if (attempts >= MAX_POLL_ATTEMPTS) {
        window.sessionStorage.removeItem(PENDING_KEY);
        return;
      }
      timeoutId = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    timeoutId = window.setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [fetchBalance]);

  async function buy(packId: string) {
    setPending(packId);
    setError(null);
    try {
      const r = await post(`${BACKEND_URL}/billing/tokens`, { packId });
      if (r.checkoutUrl) {
        if (typeof window !== "undefined" && balance !== null) {
          window.sessionStorage.setItem(PENDING_KEY, String(balance));
        }
        window.location.href = r.checkoutUrl;
      } else {
        setError(`Checkout unavailable: ${r.error ?? "unknown"}`);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      id="token-store"
      className="buttercupp-glass mx-auto w-full max-w-4xl scroll-mt-6 rounded-2xl p-5 sm:p-6"
      data-testid="token-store"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--bc-honey) / 0.18), hsl(var(--bc-amber) / 0.18))",
              color: "hsl(var(--bc-amber))",
            }}
            aria-hidden
          >
            <Coins className="h-4 w-4" />
          </div>
          <span
            className="text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "hsl(var(--bc-muted))" }}
          >
            Current balance
          </span>
        </div>
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold"
          style={{
            backgroundColor: "hsl(var(--bc-amber) / 0.15)",
            color: "hsl(var(--bc-amber))",
          }}
          data-testid="token-balance"
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          {balance ?? "-"} tokens
        </div>
      </div>

      {error ? (
        <div
          className="mt-4 rounded-xl border p-2.5 text-xs"
          style={{
            borderColor: "hsl(var(--bc-amber) / 0.5)",
            backgroundColor: "hsl(var(--bc-amber) / 0.1)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(packs ?? []).map((pack) => (
          <div
            key={pack.id}
            data-testid={`pack-${pack.id}`}
            className="flex flex-col gap-2 rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--bc-amber)/0.4)]"
            style={{
              borderColor: "hsl(var(--bc-border))",
              backgroundColor: "hsl(var(--bc-surface-2) / 0.5)",
            }}
          >
            <span className="font-display text-base font-semibold">{pack.label}</span>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-3xl font-extrabold tracking-tight">${pack.priceUsd}</span>
              <span className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                one-time
              </span>
            </div>
            <div className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
              {pack.credits.toLocaleString()} tokens
            </div>
            <button
              type="button"
              onClick={() => buy(pack.id)}
              disabled={pending === pack.id}
              data-testid={`buy-pack-${pack.id}`}
              className="mt-2 w-full rounded-xl py-2.5 text-sm font-bold shadow-[0_8px_24px_-12px_hsl(var(--bc-amber)/0.6)] transition-all duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))] disabled:opacity-60"
              style={{
                background: "var(--bc-gradient-brand-v)",
                color: "hsl(28 45% 9%)",
              }}
            >
              {pending === pack.id ? "Redirecting..." : "Buy"}
            </button>
          </div>
        ))}
        {!packs ? (
          <div
            className="col-span-full rounded-2xl border p-4 text-center text-sm"
            style={{ borderColor: "hsl(var(--bc-border))", color: "hsl(var(--bc-muted))" }}
          >
            Loading token packs...
          </div>
        ) : null}
      </div>
    </div>
  );
}
