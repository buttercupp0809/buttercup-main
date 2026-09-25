"use client";

import { useState, useEffect } from "react";

interface Props {
  characterId: string;
  characterName: string;
}

// Inline Telegram paper-plane SVG - no external dependency.
function TelegramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 14.07l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.936.516z" />
    </svg>
  );
}

export function TelegramHeaderButton({ characterId, characterName }: Props) {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/telegram/status/${characterId}`)
      .then((r) => r.json())
      .then((d: { linked: boolean }) => setLinked(d.linked))
      .catch(() => setLinked(false));
  }, [characterId]);

  async function handleClick() {
    if (linked) {
      setOpen((o) => !o);
      return;
    }
    if (deepLink) {
      setOpen((o) => !o);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setError(
          d.error === "no_bot_configured_for_character"
            ? "Telegram not yet available for this character."
            : "Something went wrong. Try again.",
        );
        return;
      }
      const d = await res.json() as { deepLink: string };
      setDeepLink(d.deepLink);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    await fetch("/api/telegram/disconnect", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
    });
    setLinked(false);
    setDeepLink(null);
    setOpen(false);
  }

  // Don't render until we know the link status (avoids flash).
  if (linked === null) return null;

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        aria-label={linked ? "You're on Telegram" : "Chat with me on Telegram"}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 sm:px-3"
        style={{ backgroundColor: "#0088cc" }}
      >
        <TelegramIcon size={14} />
        {/* Hide label on very small screens where space is tight */}
        <span className="hidden sm:inline">
          {linked ? "Chat with me" : "Chat with me"}
        </span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Popover */}
          <div
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border p-4 shadow-xl"
            style={{
              backgroundColor: "hsl(var(--buttercupp-surface))",
              borderColor: "hsl(var(--buttercupp-border))",
            }}
          >
            {linked ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-white">
                  We're connected on Telegram
                </p>
                <p className="text-xs text-slate-400">
                  Find me in your Telegram and keep chatting there.
                </p>
                <button
                  onClick={disconnect}
                  className="text-xs text-slate-400 underline underline-offset-2 hover:text-white"
                >
                  Disconnect
                </button>
              </div>
            ) : error ? (
              <div className="space-y-2">
                <p className="text-sm text-red-400">{error}</p>
                <button
                  onClick={() => setOpen(false)}
                  className="text-xs text-slate-500 underline"
                >
                  Close
                </button>
              </div>
            ) : loading ? (
              <p className="text-sm text-slate-400">Generating link...</p>
            ) : deepLink ? (
              <div className="space-y-3">
                <p className="text-sm text-white">
                  Come find me on Telegram!
                </p>
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: "#0088cc" }}
                >
                  <TelegramIcon size={16} />
                  Open in Telegram
                </a>
                <p className="text-xs text-slate-500">Link expires in 15 minutes.</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
