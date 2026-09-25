"use client";

import { useState, useEffect } from "react";

interface Props {
  characterId: string;
  characterName: string;
}

export function TelegramConnectBanner({ characterId, characterName }: Props) {
  const [status, setStatus] = useState<"loading" | "linked" | "unlinked" | "dismissed">("loading");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(`tg-banner-dismissed-${characterId}`);
    if (dismissed) { setStatus("dismissed"); return; }

    fetch(`/api/telegram/status/${characterId}`)
      .then((r) => r.json())
      .then((data: { linked: boolean }) => setStatus(data.linked ? "linked" : "unlinked"))
      .catch(() => setStatus("dismissed"));
  }, [characterId]);

  function dismiss() {
    sessionStorage.setItem(`tg-banner-dismissed-${characterId}`, "1");
    setStatus("dismissed");
  }

  async function connect() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if ((data as { error?: string }).error === "no_bot_configured_for_character") {
          setError("Telegram is not yet available for this character.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        return;
      }
      const data = await res.json() as { deepLink: string };
      setDeepLink(data.deepLink);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function disconnect() {
    await fetch("/api/telegram/disconnect", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
    });
    setStatus("unlinked");
    setDeepLink(null);
  }

  if (status === "loading" || status === "dismissed") return null;

  return (
    <div className="mx-4 mb-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm">
      {status === "linked" ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-blue-300">Connected to Telegram</span>
          <div className="flex gap-2">
            <button
              onClick={disconnect}
              className="text-xs text-slate-400 underline underline-offset-2 hover:text-white"
            >
              Disconnect
            </button>
            <button onClick={dismiss} className="text-slate-500 hover:text-white" aria-label="Close">
              x
            </button>
          </div>
        </div>
      ) : deepLink ? (
        <div className="flex flex-col gap-2">
          <p className="text-slate-300">
            Tap the link below to open {characterName} on Telegram:
          </p>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-[#0088cc] px-3 py-1.5 text-white text-xs font-medium hover:bg-[#0077b5]"
          >
            Open in Telegram
          </a>
          <p className="text-xs text-slate-500">Link expires in 15 minutes.</p>
          <button onClick={dismiss} className="self-start text-xs text-slate-500 underline">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-300">
            <span>Chat with {characterName} on Telegram</span>
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={connect}
              disabled={generating}
              className="rounded-lg bg-[#0088cc] px-3 py-1 text-xs font-medium text-white hover:bg-[#0077b5] disabled:opacity-50"
            >
              {generating ? "Connecting..." : "Connect"}
            </button>
            <button onClick={dismiss} className="text-slate-500 hover:text-white" aria-label="Close">
              x
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
