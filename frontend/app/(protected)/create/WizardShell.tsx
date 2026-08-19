"use client";

import * as React from "react";
import { useCharacterWizard } from "./context";
import { CHARACTER_STEPS } from "./steps";
import { PreviewCard } from "@/components/create/PreviewCard";
import { GenerationStatus } from "@/components/create/GenerationStatus";

export function WizardShell({ children }: { children: React.ReactNode }) {
  const { currentStepKey, canContinue, saving, goNext, goBack, submit, draft, mode } =
    useCharacterWizard();
  const currentIndex = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
  const isLast = currentIndex === CHARACTER_STEPS.length - 1;
  // Set once Finish succeeds; swaps the step content for the generation
  // status screen instead of navigating away immediately (Build step 8).
  // Navigation to /chat/:id is never blocked on generation finishing.
  const [finishedId, setFinishedId] = React.useState<string | null>(null);

  async function handleFinish() {
    const result = await submit();
    if (result.ok) {
      setFinishedId(result.id);
    } else {
      alert(`Save failed: ${result.error}`);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[1fr_320px] md:gap-6 md:px-6 md:py-6">
      {/*
        Mobile: the preview is moved above the form so the user can see their
        companion forming as they fill the wizard. On desktop it stays in the
        right-hand sticky column as before.
      */}
      <aside className="order-first md:order-last">
        <div className="sticky top-0 z-10 pb-2 md:sticky md:top-4 md:pb-0 md:pt-0">
          <h2
            className="mb-2 hidden font-display text-xs font-semibold uppercase tracking-wide md:block"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            Live preview
          </h2>
          <PreviewCard draft={draft} />
        </div>
      </aside>

      <div>
        {!finishedId && (
          <ol className="mb-4 flex items-center gap-1.5 overflow-x-auto text-sm md:mb-6 md:gap-2 md:overflow-visible [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CHARACTER_STEPS.map((s, i) => (
              <li
                key={s.key}
                className="flex shrink-0 items-center gap-1.5 md:gap-2"
                style={{
                  color:
                    i === currentIndex
                      ? "hsl(var(--buttercupp-accent-rose))"
                      : i < currentIndex
                        ? "hsl(var(--buttercupp-fg))"
                        : "hsl(var(--buttercupp-muted))",
                  fontWeight: i === currentIndex ? 600 : 400,
                }}
              >
                <span
                  className="rounded-full px-2 py-0.5 text-xs md:border md:border-current"
                  style={
                    i === currentIndex
                      ? {
                          backgroundColor: "hsl(var(--buttercupp-accent-rose))",
                          color: "hsl(var(--buttercupp-bg))",
                          borderColor: "hsl(var(--buttercupp-accent-rose))",
                        }
                      : undefined
                  }
                >
                  {i + 1}
                </span>
                <span className="hidden md:inline">{s.label}</span>
                {i < CHARACTER_STEPS.length - 1 ? (
                  <span className="hidden md:inline" style={{ color: "hsl(var(--buttercupp-border))" }}>
                    -
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        <div
          className="rounded-xl border p-4 md:p-6"
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface))",
            borderColor: "hsl(var(--buttercupp-border))",
          }}
        >
          {finishedId ? <GenerationStatus characterId={finishedId} /> : children}
        </div>

        {!finishedId && (
          <div className="mt-6 border-t border-[hsl(var(--bc-border))] pt-4 md:mt-6 md:border-transparent md:pt-0">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={currentIndex === 0}
                className="h-11 rounded-md border px-5 text-sm disabled:opacity-50"
                style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-fg))" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={isLast ? handleFinish : goNext}
                disabled={!canContinue || (isLast && saving)}
                className="h-11 rounded-md px-5 text-sm font-semibold disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--buttercupp-accent-rose))",
                  color: "hsl(var(--buttercupp-primary-fg))",
                }}
              >
                {isLast ? (saving ? "Saving..." : mode === "edit" ? "Save changes" : "Finish") : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
