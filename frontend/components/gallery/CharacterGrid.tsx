"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CharacterCardDTO, CharacterListResponse } from "@buttercupp/shared";
import { CharacterCard } from "./CharacterCard";
import { Button } from "@/components/ui/button";

// Promote the first tile of each page of results, then one mid-page tile, so the
// rhythm breaks twice per 12 and stays predictable as more pages load in.
function isFeatured(index: number): boolean {
  const slot = index % 12;
  return slot === 0 || slot === 7;
}

export interface CharacterGridProps {
  initialItems: CharacterCardDTO[];
  initialNextCursor: string | null;
  viewerAllowsMature: boolean;
}

export function CharacterGrid({
  initialItems,
  initialNextCursor,
  viewerAllowsMature,
}: CharacterGridProps) {
  const params = useSearchParams();
  const [items, setItems] = React.useState<CharacterCardDTO[]>(initialItems);
  const [cursor, setCursor] = React.useState<string | null>(initialNextCursor);
  const [loading, setLoading] = React.useState(false);

  // Reset the list whenever a non-cursor query param changes (parent re-renders
  // the server component; initialItems changes and we sync).
  React.useEffect(() => {
    setItems(initialItems);
    setCursor(initialNextCursor);
  }, [initialItems, initialNextCursor]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const usp = new URLSearchParams(params.toString());
      usp.set("cursor", cursor);
      const res = await fetch(`/api/characters?${usp.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as CharacterListResponse;
      // Dedupe by id in case the server returns overlap during rapid clicks.
      const seen = new Set(items.map((i) => i.id));
      const fresh = body.items.filter((i) => !seen.has(i.id));
      setItems((prev) => [...prev, ...fresh]);
      setCursor(body.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Editorial grid, not a uniform contact sheet. Two tiles per page of
        results are promoted to a 2x2 span so the eye has somewhere to land;
        dense flow backfills the single-column slots so no holes open up. Below
        lg the spans are dropped and it collapses to a plain 2-up.
      */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:gap-5 lg:grid-cols-4 lg:[grid-auto-flow:dense]">
        {items.map((c, i) => (
          <CharacterCard
            key={c.id}
            character={c}
            viewerAllowsMature={viewerAllowsMature}
            index={i}
            className={isFeatured(i) ? "lg:col-span-2 lg:row-span-2" : undefined}
          />
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyResults />
      ) : null}
      {cursor ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} disabled={loading} variant="outline" className="tap-target">
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Filters can legitimately return nothing. Say what to do about it and give the
// user a one-click way out instead of a bare sentence.
function EmptyResults() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--bc-radius-lg)] border border-dashed border-[hsl(var(--bc-border-strong))] px-6 py-16 text-center">
      <p className="font-display text-xl font-semibold text-[hsl(var(--bc-fg))]">
        Nobody matches that combination.
      </p>
      <p className="max-w-[42ch] text-sm text-[hsl(var(--bc-muted))]">
        Loosen a filter or two. The roster grows every week, so an empty result today is not an
        empty result tomorrow.
      </p>
      <Link href="/gallery" className="mt-1">
        <Button variant="outline" size="sm">
          Clear all filters
        </Button>
      </Link>
    </div>
  );
}
