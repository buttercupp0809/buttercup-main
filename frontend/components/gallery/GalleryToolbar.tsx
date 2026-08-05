"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface GalleryToolbarProps {
  viewerAllowsMature: boolean;
  availableTags?: string[];
}

const SORTS = ["popular", "new", "trending"] as const;
type Sort = (typeof SORTS)[number];
const STYLES = ["realistic", "3d", "anime"] as const;
const RATINGS = ["sfw", "mature"] as const;

// Toolbar contract (do not regress):
//   - All state lives in the URL so the server component drives results.
//   - Any filter/sort/search change drops `cursor` so we do not paginate a
//     stale query.
//   - Search input is debounced 300ms.
//   - Mature rating select stays hidden when the viewer cannot see mature.
export function GalleryToolbar({ viewerAllowsMature, availableTags }: GalleryToolbarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const [q, setQ] = React.useState(params.get("q") ?? "");

  const push = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      next.delete("cursor");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    const t = setTimeout(() => {
      push({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // Debouncer runs on `q` changes; `push` is stable per URL change.
  }, [q]);

  const sort = (params.get("sort") ?? "popular") as Sort;
  const style = params.get("style") ?? "";
  const rating = params.get("contentRating") ?? "";
  const activeTags = React.useMemo(() => {
    const raw = params.get("tags") ?? "";
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [params]);

  function toggleTag(tag: string) {
    const next = new Set(activeTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    push({ tags: next.size > 0 ? Array.from(next).join(",") : null });
  }

  const controlBase =
    "rounded-md px-3 py-1.5 text-sm border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400";
  const controlStyle: React.CSSProperties = {
    backgroundColor: "hsl(var(--poppy-surface-2, 210 40% 96%))",
    borderColor: "hsl(var(--poppy-border, 214 32% 91%))",
    color: "inherit",
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b pb-4"
      style={{ borderColor: "hsl(var(--poppy-border, 214 32% 91%))" }}
    >
      {/* Segmented sort control: one tap per sort mode. */}
      <div
        role="tablist"
        aria-label="Sort characters"
        className="inline-flex overflow-hidden rounded-md border"
        style={{ borderColor: "hsl(var(--poppy-border, 214 32% 91%))" }}
      >
        {SORTS.map((s) => {
          const active = sort === s;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`sort-${s}`}
              onClick={() => push({ sort: s })}
              className={cn(
                "px-3 py-1.5 text-sm capitalize transition",
                active ? "text-black" : "opacity-70 hover:opacity-100",
              )}
              style={{
                backgroundColor: active
                  ? "hsl(var(--poppy-accent-rose, 344 84% 71%))"
                  : "hsl(var(--poppy-surface-2, 210 40% 96%))",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Keep <select>s for style/rating: accessible, familiar, saves a11y work. */}
      <select
        aria-label="Style"
        data-testid="filter-style"
        value={style}
        onChange={(e) => push({ style: e.target.value || null })}
        className={controlBase}
        style={controlStyle}
      >
        <option value="">All styles</option>
        {STYLES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {viewerAllowsMature ? (
        <select
          aria-label="Content rating"
          data-testid="filter-rating"
          value={rating}
          onChange={(e) => push({ contentRating: e.target.value || null })}
          className={controlBase}
          style={controlStyle}
        >
          <option value="">All ratings</option>
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}

      <input
        aria-label="Search characters"
        data-testid="search-input"
        type="search"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={cn(controlBase, "ml-auto min-w-0 flex-1")}
        style={controlStyle}
      />

      {availableTags && availableTags.length > 0 ? (
        <div className="flex w-full flex-wrap gap-2 pt-1">
          {availableTags.map((t) => {
            const on = activeTags.has(t);
            return (
              <button
                key={t}
                type="button"
                data-testid={`tag-${slugify(t)}`}
                aria-pressed={on}
                onClick={() => toggleTag(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
                  on ? "text-black" : "opacity-80 hover:opacity-100",
                )}
                style={{
                  backgroundColor: on
                    ? "hsl(var(--poppy-accent-rose, 344 84% 71%))"
                    : "hsl(var(--poppy-surface-2, 210 40% 96%))",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
