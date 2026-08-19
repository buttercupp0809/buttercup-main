"use client";

// Client picker for the optional first-companion step. Tapping a card just
// records a selection in the draft (it must not navigate away mid-wizard,
// which is why this does NOT reuse CharacterCard's <Link>). "Skip for now"
// records null and advances immediately.

import type { CharacterCardDTO } from "@buttercupp/shared";
import { Check } from "lucide-react";
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
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Someone caught your eye? Tap to start there. No rush, you can always meet the others later.
        </p>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((c, index) => {
            const selected = selectedId === c.id;
            const gated = c.contentRating === "mature" && !viewerAllowsMature;
            return (
              <button
                key={c.id}
                type="button"
                data-testid="onboarding-pick-card"
                onClick={() => updateDraft({ firstCharacterId: c.id })}
                aria-pressed={selected}
                // CSS-var index feeds the staggered bc-rise entrance; the cast is
                // the documented pattern for typing custom properties on style.
                style={{
                  ["--i" as unknown as string]: index,
                  border: selected
                    ? "2px solid hsl(var(--bc-amber))"
                    : "2px solid hsl(var(--bc-cream) / 0.08)",
                  boxShadow: selected
                    ? "0 0 0 1px hsl(var(--bc-amber) / 0.35), 0 0 24px hsl(var(--bc-amber) / 0.35), 0 8px 24px hsl(28 40% 2% / 0.5)"
                    : "0 4px 12px hsl(28 40% 2% / 0.4)",
                  backgroundColor: "hsl(var(--bc-surface-2))",
                  transform: selected ? "scale(1.03)" : undefined,
                }}
                className="group bc-press motion-safe:bc-rise relative flex aspect-[3/4] flex-col overflow-hidden rounded-xl text-left transition-all duration-200"
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt={c.name}
                    className={`absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105 ${gated ? "scale-110 blur-lg group-hover:scale-110" : ""}`}
                  />
                ) : (
                  <div
                    className="absolute inset-0 flex items-center justify-center font-display text-2xl font-semibold transition-transform duration-300 group-hover:scale-105"
                    style={{ color: "hsl(var(--bc-muted))" }}
                  >
                    {c.name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />
                {selected ? (
                  <div
                    className="motion-safe:bc-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: "hsl(var(--bc-amber))",
                      color: "hsl(28 45% 9%)",
                    }}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
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
        <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          No recommendations available right now. You can browse the gallery any time.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="lg"
        data-testid="onboarding-skip"
        onClick={skip}
        className="bc-press"
      >
        Skip for now, I will browse later
      </Button>
    </div>
  );
}
