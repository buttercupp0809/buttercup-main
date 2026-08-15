"use client";

// Client picker for the optional first-companion step. Tapping a card just
// records a selection in the draft (it must not navigate away mid-wizard,
// which is why this does NOT reuse CharacterCard's <Link>). "Skip for now"
// records null and advances immediately.

import type { CharacterCardDTO } from "@buttercupp/shared";
import { useOnboardingWizard } from "../context";
import { Button } from "@/components/ui/button";

export interface RecommendationsProps {
  items: CharacterCardDTO[];
  viewerAllowsMature: boolean;
}

export function Recommendations({ items, viewerAllowsMature }: RecommendationsProps) {
  const { draft, updateDraft, goNext } = useOnboardingWizard();
  const selectedId = draft.firstCharacterId ?? null;

  function skip() {
    updateDraft({ firstCharacterId: null });
    goNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Meet your first companion</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Optional. Tap one to start there, or skip and browse later.
        </p>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((c) => {
            const selected = selectedId === c.id;
            const gated = c.contentRating === "mature" && !viewerAllowsMature;
            return (
              <button
                key={c.id}
                type="button"
                data-testid="onboarding-pick-card"
                onClick={() => updateDraft({ firstCharacterId: c.id })}
                aria-pressed={selected}
                className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-xl text-left transition-all duration-200"
                style={{
                  border: selected
                    ? "2px solid hsl(var(--buttercupp-accent-rose))"
                    : "2px solid rgba(255,255,255,0.08)",
                  boxShadow: selected
                    ? "0 0 0 1px hsl(var(--buttercupp-accent-rose) / 0.3), 0 8px 24px rgba(0,0,0,0.4)"
                    : "0 4px 12px rgba(0,0,0,0.25)",
                  backgroundColor: "hsl(var(--buttercupp-surface-2))",
                }}
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt={c.name}
                    className={`absolute inset-0 h-full w-full object-cover object-top ${gated ? "scale-110 blur-lg" : ""}`}
                  />
                ) : (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-2xl font-semibold"
                    style={{ color: "hsl(var(--buttercupp-muted))" }}
                  >
                    {c.name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />
                {selected ? (
                  <div
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background:
                        "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                      color: "#ffffff",
                    }}
                  >
                    ✓
                  </div>
                ) : null}
                {gated ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-center text-[10px] font-medium text-white">
                    18+ verify to view
                  </div>
                ) : null}
                <span className="relative z-10 mt-auto p-2 text-xs font-semibold text-white drop-shadow">
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          No recommendations available right now. You can browse the gallery any time.
        </p>
      )}

      <Button type="button" variant="outline" size="lg" data-testid="onboarding-skip" onClick={skip}>
        Skip for now
      </Button>
    </div>
  );
}
