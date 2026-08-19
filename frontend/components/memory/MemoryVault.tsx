"use client";

import * as React from "react";
import { Brain, Pin, X, Loader2 } from "lucide-react";
import type { MemoryDTO } from "@buttercupp/shared";
import { relativeTime } from "@/lib/text";
import { cn } from "@/lib/utils";

/*
 * "What she remembers about you."
 *
 * Memory is the product's central promise and until now it had no surface at
 * all: rows accumulated in the database, fed the prompt, and the user never saw
 * evidence any of it happened. This renders that evidence next to the
 * conversation that produced it.
 *
 * Read path is server-rendered (see lib/memories.ts) so the panel is populated
 * on first paint. Paging and deletes go through the already-shipped
 * /api/memory routes, so nothing here needs a new endpoint.
 *
 * Deleting is deliberately called "forget" and confirmed inline rather than
 * through a modal. It is a small, reversible-feeling act on one line of text;
 * a blocking dialog would make it feel like account deletion.
 */

const PAGE = 8;

export interface MemoryVaultProps {
  characterId: string;
  characterName: string;
  initialItems: MemoryDTO[];
  initialCursor: string | null;
  total: number;
}

export function MemoryVault({
  characterId,
  characterName,
  initialItems,
  initialCursor,
  total,
}: MemoryVaultProps) {
  const [items, setItems] = React.useState(initialItems);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [count, setCount] = React.useState(total);
  const [loading, setLoading] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  // Pinned first, newest next. Applied after every merge so page 2 (which the
  // API returns in createdAt order) cannot push a pinned memory below a fresh
  // trivial one.
  const ordered = React.useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [items],
  );

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/memory?characterId=${encodeURIComponent(characterId)}&cursor=${encodeURIComponent(
          cursor,
        )}&limit=${PAGE}`,
      );
      if (!res.ok) return;
      const data: { items: MemoryDTO[]; nextCursor: string | null } = await res.json();
      // Guard against a duplicate id slipping in if a row was written between
      // the server render and this fetch.
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...data.items.filter((m) => !seen.has(m.id))];
      });
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  async function forget(id: string) {
    setConfirming(null);
    const snapshot = items;
    setItems((prev) => prev.filter((m) => m.id !== id));
    setCount((c) => Math.max(0, c - 1));
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setItems(snapshot);
      setCount((c) => c + 1);
    }
  }

  return (
    <section className="px-5 pt-6">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-display text-sm font-semibold text-[hsl(var(--bc-fg))]">
          <Brain className="h-4 w-4 text-[hsl(var(--bc-amber))]" />
          What she remembers
        </h3>
        {count > 0 ? (
          <span className="tabular shrink-0 text-xs text-[hsl(var(--bc-subtle))]">
            {count} {count === 1 ? "thing" : "things"}
          </span>
        ) : null}
      </header>

      {ordered.length === 0 ? (
        <p className="rounded-[var(--bc-radius)] border border-dashed border-[hsl(var(--bc-border-strong))] px-4 py-5 text-xs leading-relaxed text-[hsl(var(--bc-muted))]">
          Nothing yet. Tell {characterName} something real about you and it lands here, in her own
          words, for her to bring up later.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ordered.map((m) => (
            <MemoryRow
              key={m.id}
              memory={m}
              confirming={confirming === m.id}
              onAskForget={() => setConfirming(m.id)}
              onCancel={() => setConfirming(null)}
              onForget={() => forget(m.id)}
            />
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="bc-press mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-[var(--bc-radius-sm)] border border-[hsl(var(--bc-border))] py-2 text-xs font-semibold text-[hsl(var(--bc-honey))] transition-colors duration-200 hover:border-[hsl(var(--bc-amber)/0.4)] hover:bg-[hsl(var(--bc-amber)/0.06)] disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {loading ? "Loading" : "Show older memories"}
        </button>
      ) : null}
    </section>
  );
}

function MemoryRow({
  memory,
  confirming,
  onAskForget,
  onCancel,
  onForget,
}: {
  memory: MemoryDTO;
  confirming: boolean;
  onAskForget: () => void;
  onCancel: () => void;
  onForget: () => void;
}) {
  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-[var(--bc-radius-sm)] border py-2 pl-3 pr-2 transition-colors duration-200 ease-[var(--ease-out)]",
        confirming
          ? "border-[hsl(var(--bc-danger)/0.4)] bg-[hsl(var(--bc-danger)/0.08)]"
          : "border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2)/0.5)] hover:border-[hsl(var(--bc-amber)/0.28)]",
      )}
    >
      {/*
        Left edge carries importance: the pipeline scores every memory 0..1 and
        that score is the difference between "likes oat milk" and "father died in
        March". Opacity is the honest way to show it without inventing a badge.
      */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{
          backgroundColor: `hsl(var(--bc-amber) / ${(0.25 + memory.importance * 0.75).toFixed(2)})`,
        }}
      />

      {confirming ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[hsl(var(--bc-fg))]">Make her forget this?</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onForget}
              className="bc-press rounded-full bg-[hsl(var(--bc-danger)/0.18)] px-2.5 py-1 text-xs font-semibold text-[hsl(2_84%_74%)]"
            >
              Forget
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="bc-press rounded-full px-2.5 py-1 text-xs font-medium text-[hsl(var(--bc-muted))] hover:text-[hsl(var(--bc-fg))]"
            >
              Keep
            </button>
          </span>
        </div>
      ) : (
        <>
          <p className="pr-5 text-[0.8125rem] leading-snug text-[hsl(var(--bc-fg))]">
            {memory.content}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {memory.pinned ? (
              <Pin className="h-3 w-3 shrink-0 text-[hsl(var(--bc-amber))]" aria-label="Pinned" />
            ) : null}
            <span className="truncate text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--bc-subtle))]">
              {memory.category.replace(/[_-]+/g, " ")}
            </span>
            <span className="tabular ml-auto shrink-0 text-[0.6875rem] text-[hsl(var(--bc-subtle))]">
              {relativeTime(memory.createdAt)}
            </span>
          </div>

          <button
            type="button"
            onClick={onAskForget}
            aria-label="Make her forget this"
            className={cn(
              "absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-[hsl(var(--bc-subtle))]",
              "opacity-0 transition-[opacity,color,background-color] duration-200 hover:bg-[hsl(var(--bc-cream)/0.08)] hover:text-[hsl(var(--bc-fg))]",
              // Always reachable by keyboard and on touch, where hover never fires.
              "focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60",
            )}
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}
    </li>
  );
}
