"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Check, Sparkles } from "lucide-react";
import { useCharacterWizard } from "./context";
import { CHARACTER_STEPS } from "./steps";
import { PreviewCard } from "@/components/create/PreviewCard";
import { GenerationStatus } from "@/components/create/GenerationStatus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

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

  const stepLabel = CHARACTER_STEPS[currentIndex]?.label ?? "";
  const progressPct = ((currentIndex + 1) / CHARACTER_STEPS.length) * 100;
  const isEdit = mode === "edit";

  return (
    <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
      {!finishedId && (
        <PageHeader
          eyebrow={isEdit ? "Editing companion" : `Step ${currentIndex + 1} of ${CHARACTER_STEPS.length}`}
          title={isEdit ? "Refine your" : "Create your"}
          accent="companion"
          description={
            isEdit
              ? "Adjust identity, appearance, personality, or publish settings."
              : "Style, identity, appearance, personality, and publish. Under a minute, and yours."
          }
        />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {!finishedId && <Stepper currentIndex={currentIndex} progressPct={progressPct} />}

          <div className="buttercupp-glass relative overflow-hidden rounded-2xl p-6 sm:p-8">
            {!finishedId ? (
              <div
                className="pointer-events-none absolute inset-x-0 -top-px h-px"
                aria-hidden
                style={{
                  background:
                    "linear-gradient(90deg, transparent, hsl(var(--buttercupp-accent-rose) / 0.6), hsl(var(--buttercupp-accent-violet) / 0.6), transparent)",
                }}
              />
            ) : null}
            {finishedId ? <GenerationStatus characterId={finishedId} /> : children}
          </div>

          {!finishedId && (
            <div
              className="mt-6 flex flex-col-reverse items-stretch gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between"
              style={{
                borderColor: "hsl(var(--buttercupp-border))",
                backgroundColor: "hsl(var(--buttercupp-surface) / 0.6)",
              }}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={goBack}
                disabled={currentIndex === 0}
                className="sm:w-auto"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <div
                className="hidden text-xs sm:block"
                style={{ color: "hsl(var(--buttercupp-muted))" }}
              >
                {stepLabel}
              </div>
              <Button
                type="button"
                onClick={isLast ? handleFinish : goNext}
                disabled={!canContinue || (isLast && saving)}
                className="sm:w-auto"
              >
                {isLast ? (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {saving ? "Saving..." : isEdit ? "Save changes" : "Finish"}
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        <aside>
          <div className="sticky top-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                }}
                aria-hidden
              />
              <h2
                className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "hsl(var(--buttercupp-muted))" }}
              >
                Live preview
              </h2>
            </div>
            <PreviewCard draft={draft} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Stepper({
  currentIndex,
  progressPct,
}: {
  currentIndex: number;
  progressPct: number;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div
        className="h-1 overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
        aria-hidden
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
          }}
        />
      </div>
      <ol
        className="flex flex-wrap items-center gap-2 text-xs sm:text-sm"
        aria-label="Wizard progress"
      >
        {CHARACTER_STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li
              key={s.key}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-2"
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition"
                style={
                  active
                    ? {
                        background:
                          "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
                        color: "white",
                        boxShadow: "0 4px 14px -6px hsl(344 84% 60% / 0.6)",
                      }
                    : done
                      ? {
                          backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.18)",
                          color: "hsl(var(--buttercupp-accent-rose))",
                        }
                      : {
                          backgroundColor: "hsl(var(--buttercupp-surface-2))",
                          color: "hsl(var(--buttercupp-muted))",
                          border: "1px solid hsl(var(--buttercupp-border))",
                        }
                }
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className="whitespace-nowrap font-medium"
                style={{
                  color: active
                    ? "hsl(var(--buttercupp-fg))"
                    : done
                      ? "hsl(var(--buttercupp-fg))"
                      : "hsl(var(--buttercupp-muted))",
                }}
              >
                {s.label}
              </span>
              {i < CHARACTER_STEPS.length - 1 ? (
                <span
                  className="hidden h-px w-6 sm:inline-block"
                  aria-hidden
                  style={{
                    backgroundColor: done
                      ? "hsl(var(--buttercupp-accent-rose) / 0.4)"
                      : "hsl(var(--buttercupp-border))",
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
