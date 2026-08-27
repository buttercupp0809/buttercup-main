"use client";

// Shared wizard chrome: a premium segmented stepper up top + a sticky footer
// Back/Continue nav. Mobile-first single column, large tap targets. The
// "finish" step renders its own single CTA (see finish/page.tsx), so the
// generic footer nav is hidden there to avoid a duplicate button.

import { Check } from "lucide-react";
import { useOnboardingWizard } from "./context";
import { ONBOARDING_STEPS } from "./steps";
import { Button } from "@/components/ui/button";

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const { currentStepKey, canContinue, goNext, goBack } = useOnboardingWizard();
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === currentStepKey);
  const isFinish = currentStepKey === "finish";

  // The connecting track must run between the CENTERS of the first and last
  // nodes, not edge to edge. Each node is centered in a flex-1 cell of width
  // 100/N%, so the first center sits at half a cell (50/N %) from the left and
  // the last the same distance from the right. Insetting the track by that
  // amount avoids a stray stub running past the last node to the card edge.
  const nodeCount = ONBOARDING_STEPS.length;
  const edgeInset = nodeCount > 0 ? 50 / nodeCount : 0; // percent
  // Amber fill starts at the first node center and reaches the active node
  // center: that distance is (currentIndex / N) of the full container width.
  const fillPercent = nodeCount > 0 ? (currentIndex / nodeCount) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Segmented stepper: a filling track behind labeled nodes. */}
      <div className="flex flex-col gap-2">
        <ol className="relative flex items-start justify-between">
          {/* Decorative track sits behind the nodes, inset to span first node
              center to last node center (see edgeInset above). */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-3 h-0.5 sm:top-3.5"
            style={{
              left: `${edgeInset}%`,
              right: `${edgeInset}%`,
              backgroundColor: "hsl(var(--bc-border))",
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-3 h-0.5 transition-all duration-500 sm:top-3.5"
            style={{
              left: `${edgeInset}%`,
              width: `${fillPercent}%`,
              backgroundColor: "hsl(var(--bc-amber))",
            }}
          />

          {ONBOARDING_STEPS.map((s, i) => {
            const isComplete = i < currentIndex;
            const isActive = i === currentIndex;
            return (
              <li
                key={s.key}
                className="relative z-10 flex flex-1 flex-col items-center gap-1.5"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 sm:h-7 sm:w-7"
                  style={
                    isComplete
                      ? {
                          backgroundColor: "hsl(var(--bc-amber))",
                          color: "hsl(var(--bc-surface))",
                          border: "1px solid hsl(var(--bc-amber))",
                        }
                      : isActive
                        ? {
                            // Opaque base (surface) with an amber tint overlay so
                            // the connector track behind the node is fully hidden
                            // and never shows through to the number. A translucent
                            // fill would let the line cut across the circle center.
                            background:
                              "linear-gradient(0deg, hsl(var(--bc-amber) / 0.2), hsl(var(--bc-amber) / 0.2)), hsl(var(--bc-surface-2))",
                            color: "hsl(var(--bc-amber-hot))",
                            border: "1px solid hsl(var(--bc-amber))",
                            boxShadow: "0 0 0 4px hsl(var(--bc-amber) / 0.15)",
                          }
                        : {
                            backgroundColor: "hsl(var(--bc-surface-2))",
                            color: "hsl(var(--bc-subtle))",
                            border: "1px solid hsl(var(--bc-border))",
                          }
                  }
                >
                  {isComplete ? (
                    <span aria-hidden className="motion-safe:bc-pop">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                  ) : (
                    <span aria-hidden>{i + 1}</span>
                  )}
                </span>
                <span
                  className="text-[10px] font-medium uppercase tracking-wider transition-colors sm:text-xs"
                  style={{
                    color: isActive
                      ? "hsl(var(--bc-fg))"
                      : "hsl(var(--bc-subtle))",
                  }}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

      </div>

      <div>{children}</div>

      {!isFinish ? (
        <div
          className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between gap-3 border-t px-6 py-4 sm:-mx-8 sm:-mb-8 sm:px-8"
          style={{
            borderColor: "hsl(var(--bc-border))",
            backgroundColor: "hsl(var(--bc-surface) / 0.9)",
          }}
        >
          <Button
            type="button"
            variant="outline"
            size="lg"
            data-testid="onboarding-back"
            onClick={goBack}
            disabled={currentIndex === 0}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            type="button"
            size="lg"
            data-testid="onboarding-continue"
            onClick={goNext}
            disabled={!canContinue}
            className="flex-1"
          >
            Continue
          </Button>
        </div>
      ) : null}
    </div>
  );
}
