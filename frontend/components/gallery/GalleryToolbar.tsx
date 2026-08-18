"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, SlidersHorizontal, Flame, Sparkles, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryToolbarProps {
  viewerAllowsMature: boolean;
  availableTags?: string[];
}

const SORTS = ["popular", "new", "trending"] as const;
type Sort = (typeof SORTS)[number];
const SORT_ICON: Record<Sort, React.ComponentType<{ className?: string }>> = {
  popular: Flame,
  new: Sparkles,
  trending: Clock,
};
const STYLES = ["realistic", "3d", "anime"] as const;
// Toolbar contract (do not regress):
//   - All state lives in the URL so the server component drives results.
//   - Any filter/sort/search change drops `cursor` so we do not paginate a
//     stale query.
//   - Search input is debounced 300ms.
export function GalleryToolbar({
  viewerAllowsMature: _viewerAllowsMature,
  availableTags,
}: GalleryToolbarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const [q, setQ] = React.useState(params.get("q") ?? "");
  // Guards the debounce effect below against firing on mount. `q`'s initial
  // value already equals the URL's `q`, so a mount-time push is always a
  // no-op replace, but it still starts a real navigation. If that fires
  // 300ms later (e.g. while a slow RSC fetch for a just-clicked character
  // card is still in flight during a cold dev compile), router.replace here
  // wins the race and yanks the user straight back to /gallery mid-navigation.
  const mounted = React.useRef(false);

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
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => {
      push({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // Debouncer runs on `q` changes; `push` is stable per URL change.
  }, [q]);

  const sort = (params.get("sort") ?? "popular") as Sort;
  const style = params.get("style") ?? "";
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

  const activeFilterCount = (style ? 1 : 0) + activeTags.size;

  return (
    <div className="buttercupp-glass flex flex-col gap-4 rounded-2xl p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Segmented sort control */}
        <div
          role="tablist"
          aria-label="Sort characters"
          className="inline-flex items-center rounded-full border p-1"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface-2) / 0.6)",
          }}
        >
          {SORTS.map((s) => {
            const active = sort === s;
            const Icon = SORT_ICON[s];
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`sort-${s}`}
                onClick={() => push({ sort: s })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-all duration-200",
                  active
                    ? "text-white shadow-[0_6px_18px_-8px_hsl(344_84%_71%/0.55)]"
                    : "text-[hsl(var(--buttercupp-muted))] hover:text-white",
                )}
                style={
                  active
                    ? {
                        background:
                          "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                      }
                    : undefined
                }
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {s}
              </button>
            );
          })}
        </div>

        {/* Style filter */}
        <div className="relative">
          <SlidersHorizontal
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
            aria-hidden
          />
          <select
            aria-label="Style"
            data-testid="filter-style"
            value={style}
            onChange={(e) => push({ style: e.target.value || null })}
            className="appearance-none rounded-full border py-2 pl-8 pr-8 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
            style={{
              borderColor: "hsl(var(--buttercupp-border))",
              backgroundColor: "hsl(var(--buttercupp-surface-2) / 0.6)",
              color: "hsl(var(--buttercupp-fg))",
            }}
          >
            <option value="">All styles</option>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Search input */}
        <div className="relative ml-auto min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
            aria-hidden
          />
          <input
            aria-label="Search characters"
            data-testid="search-input"
            type="search"
            placeholder="Search companions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-full border py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-[hsl(var(--buttercupp-muted))] focus-visible:ring-2 focus-visible:ring-rose-400/70"
            style={{
              borderColor: "hsl(var(--buttercupp-border))",
              backgroundColor: "hsl(var(--buttercupp-surface-2) / 0.6)",
              color: "hsl(var(--buttercupp-fg))",
            }}
          />
        </div>
      </div>

      {availableTags && availableTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterCount > 0 ? (
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "hsl(var(--buttercupp-muted))" }}
            >
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} ·
            </span>
          ) : null}
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
                  "rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70",
                  on
                    ? "text-white shadow-[0_4px_14px_-6px_hsl(344_84%_71%/0.5)]"
                    : "hover:-translate-y-0.5 hover:border-[hsl(var(--buttercupp-accent-rose)/0.5)]",
                )}
                style={
                  on
                    ? {
                        borderColor: "transparent",
                        background:
                          "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                      }
                    : {
                        borderColor: "hsl(var(--buttercupp-border))",
                        backgroundColor: "hsl(var(--buttercupp-surface-2) / 0.6)",
                        color: "hsl(var(--buttercupp-fg))",
                      }
                }
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
