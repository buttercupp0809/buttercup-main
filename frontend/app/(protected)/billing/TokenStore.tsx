"use client";

// One-time token pack purchases. The catalog comes from GET /billing/token-packs
// (backend/src/http/billing.ts, backed by TOKEN_PACKS in
// payments/webhooks/shared.ts) so credits/price are never hardcoded here.
// "Buy" redirects to a provider-hosted checkout; the credit itself is written
// by the webhook (transaction.completed + tokenPackId -> refundTokens) via
// the TokenLedger. This component only ever READS the resulting balance from
// GET /billing/status, it never writes it.

import * as React from "react";

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

  // Resume flow: after a redirect back from hosted checkout, poll the
  // balance until it rises above the pre-purchase baseline captured in
  // sessionStorage. Only the server-confirmed balance (via the webhook ->
  // TokenLedger write) clears the marker; the client never assumes success.
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
      className="mx-auto w-full max-w-4xl scroll-mt-6 rounded-2xl border p-6"
      style={{ borderColor: "hsl(var(--buttercupp-border))", backgroundColor: "hsl(var(--buttercupp-surface))" }}
      data-testid="token-store"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Token Store</h2>
        <div
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={{
            backgroundColor: "hsl(var(--buttercupp-accent-violet) / 0.18)",
            color: "hsl(var(--buttercupp-accent-violet))",
          }}
          data-testid="token-balance"
        >
          Balance: {balance ?? "-"} tokens
        </div>
      </div>
      <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
        Buy tokens for extra images and videos, on top of your plan quota.
      </p>

      {error ? (
        <div
          className="mt-3 rounded-md border p-2 text-xs"
          style={{
            borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
            backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.12)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(packs ?? []).map((pack) => (
          <div
            key={pack.id}
            data-testid={`pack-${pack.id}`}
            className="flex flex-col gap-2 rounded-xl border p-4"
            style={{ borderColor: "hsl(var(--buttercupp-border))", backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
          >
            <span className="font-display text-base font-semibold">{pack.label}</span>
            <span className="text-2xl font-bold">${pack.priceUsd}</span>
            <button
              type="button"
              onClick={() => buy(pack.id)}
              disabled={pending === pack.id}
              data-testid={`buy-pack-${pack.id}`}
              className="mt-1 w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{
                background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
              }}
            >
              {pending === pack.id ? "Redirecting..." : "Buy"}
            </button>
          </div>
        ))}
        {!packs ? (
          <div
            className="col-span-full rounded-xl border p-4 text-center text-sm"
            style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }}
          >
            Loading token packs...
          </div>
        ) : null}
      </div>
    </div>
  );
}
