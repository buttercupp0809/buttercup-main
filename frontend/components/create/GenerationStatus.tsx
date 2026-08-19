"use client";

// Phase 28 finish screen: polls the owner-only generation-status endpoint
// every ~2s and renders per-slot skeletons transitioning
// pending -> generating -> ready (or failed). Navigation is never blocked
// on generation; "Start chatting" is always enabled.

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { GenerationStatusResponse } from "@buttercupp/shared";
import { CREATION_IMAGE_COUNT } from "@buttercupp/shared";

const POLL_MS = 2000;
const MAX_POLLS = 60; // ~2 minutes; generation should finish long before this

type SlotState = "pending" | "generating" | "ready" | "failed";

function slotsFrom(status: GenerationStatusResponse | null): SlotState[] {
  if (!status) return Array(CREATION_IMAGE_COUNT).fill("pending");
  const slots: SlotState[] = [];
  for (let i = 0; i < status.ready; i++) slots.push("ready");
  for (let i = 0; i < status.processing; i++) slots.push("generating");
  for (let i = 0; i < status.failed; i++) slots.push("failed");
  for (let i = 0; i < status.queued; i++) slots.push("pending");
  while (slots.length < CREATION_IMAGE_COUNT) slots.push("pending");
  return slots.slice(0, CREATION_IMAGE_COUNT);
}

function SlotTile({ state }: { state: SlotState }) {
  const base = "aspect-[9/16] w-full overflow-hidden rounded-lg border";
  if (state === "ready") {
    return (
      <div
        className={base}
        style={{
          borderColor: "hsl(var(--bc-amber) / 0.4)",
          background:
            "linear-gradient(135deg, hsl(var(--bc-amber) / 0.25), hsl(var(--bc-honey) / 0.25))",
        }}
      >
        <div className="flex h-full w-full items-center justify-center text-lg">
          <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </div>
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div
        className={base}
        style={{
          borderColor: "hsl(var(--bc-danger) / 0.4)",
          backgroundColor: "hsl(var(--bc-danger) / 0.08)",
        }}
      >
        <div
          className="flex h-full w-full items-center justify-center text-xs"
          style={{ color: "hsl(var(--bc-danger))" }}
        >
          Failed
        </div>
      </div>
    );
  }
  const pulsing = state === "generating";
  return (
    <div
      className={`${base} ${pulsing ? "animate-pulse" : ""}`}
      style={{ borderColor: "hsl(var(--bc-border))", backgroundColor: "hsl(var(--bc-surface-2))" }}
    />
  );
}

export interface GenerationStatusProps {
  characterId: string;
}

export function GenerationStatus({ characterId }: GenerationStatusProps) {
  const [status, setStatus] = React.useState<GenerationStatusResponse | null>(null);
  const [primaryImageUrl, setPrimaryImageUrl] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const pollsRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/characters/${characterId}/generation-status`);
        if (!res.ok) {
          if (!cancelled) setUnavailable(true);
          return;
        }
        const body = (await res.json()) as GenerationStatusResponse;
        if (cancelled) return;
        setStatus(body);
        if (body.primaryReady && !primaryImageUrl) {
          fetch(`/api/characters/${characterId}/gallery?limit=1`)
            .then((r) => (r.ok ? r.json() : null))
            .then((g: { items?: { url: string | null }[] } | null) => {
              const url = g?.items?.[0]?.url ?? null;
              if (!cancelled && url) setPrimaryImageUrl(url);
            })
            .catch(() => null);
        }
        const allSettled =
          body.queued === 0 && body.processing === 0 && body.ready + body.failed >= CREATION_IMAGE_COUNT;
        pollsRef.current += 1;
        if (!allSettled && pollsRef.current < MAX_POLLS && !cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // primaryImageUrl intentionally excluded: it is a fetch-once side
    // effect, not something that should restart the polling loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const slots = slotsFrom(status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Bringing your companion to life</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          {unavailable
            ? "Generation is unavailable in this environment right now, but your companion is saved and ready to chat."
            : "Generating a first set of photos. You can start chatting right away, they will fill in as they finish."}
        </p>
      </div>

      {primaryImageUrl && (
        <div
          className="mx-auto w-40 overflow-hidden rounded-xl border"
          style={{ borderColor: "hsl(var(--bc-border))", aspectRatio: "9 / 16" }}
        >
          <img src={primaryImageUrl} alt="" className="h-full w-full object-cover object-top" />
        </div>
      )}

      {!unavailable && (
        <div className="grid grid-cols-4 gap-2">
          {slots.map((state, i) => (
            <SlotTile key={i} state={state} />
          ))}
        </div>
      )}

      <Link
        href={`/chat/${characterId}`}
        className="rounded-md px-4 py-2 text-center text-sm font-semibold"
        style={{
          backgroundColor: "hsl(var(--bc-amber))",
          color: "hsl(28 45% 9%)",
        }}
      >
        Start chatting
      </Link>
    </div>
  );
}
