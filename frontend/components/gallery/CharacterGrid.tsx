"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { CharacterCardDTO, CharacterListResponse } from "@poppy/shared";
import { CharacterCard } from "./CharacterCard";
import { Button } from "@/components/ui/button";

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((c, i) => (
          <CharacterCard
            key={c.id}
            character={c}
            viewerAllowsMature={viewerAllowsMature}
            index={i}
          />
        ))}
      </div>
      {items.length === 0 ? (
        <p
          className="py-12 text-center text-sm"
          style={{ color: "hsl(var(--poppy-muted, 215 16% 47%))" }}
        >
          No characters match this filter.
        </p>
      ) : null}
      {cursor ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} disabled={loading} variant="outline">
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
