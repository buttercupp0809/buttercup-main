"use client";

// Shared wizard chrome: a small step progress pill + a sticky footer
// Back/Continue nav. Mobile-first single column, large tap targets. The
// "finish" step renders its own single CTA (see finish/page.tsx), so the
// generic footer nav is hidden there to avoid a duplicate button.

import { useOnboardingWizard } from "./context";
import { ONBOARDING_STEPS } from "./steps";
import { Button } from "@/components/ui/button";

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const { currentStepKey, canContinue, goNext, goBack } = useOnboardingWizard();
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === currentStepKey);
  const isFinish = currentStepKey === "finish";

  return (
    <div className="flex flex-col gap-6">
      {/* Step progress: a labeled pill per step, active one in rose. */}
      <ol className="flex items-center justify-center gap-2">
        {ONBOARDING_STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="flex h-2 w-2 rounded-full transition-colors sm:h-2.5 sm:w-2.5"
              style={{
                backgroundColor:
                  i <= currentIndex
                    ? "hsl(var(--buttercupp-accent-rose))"
                    : "hsl(var(--buttercupp-border))",
              }}
              aria-hidden
            />
            {i < ONBOARDING_STEPS.length - 1 ? (
              <span
                className="h-px w-4 sm:w-6"
                style={{
                  backgroundColor:
                    i < currentIndex
                      ? "hsl(var(--buttercupp-accent-rose))"
                      : "hsl(var(--buttercupp-border))",
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <p
        className="-mt-3 text-center text-xs font-medium uppercase tracking-wider"
        style={{ color: "hsl(var(--buttercupp-muted))" }}
      >
        Step {currentIndex + 1} of {ONBOARDING_STEPS.length}
      </p>

      <div>{children}</div>

      {!isFinish ? (
        <div
          className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between gap-3 border-t px-6 py-4 sm:-mx-8 sm:-mb-8 sm:px-8"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface) / 0.9)",
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
