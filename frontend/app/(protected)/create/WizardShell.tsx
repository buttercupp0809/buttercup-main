"use client";

import { useRouter } from "next/navigation";
import { useCharacterWizard } from "./context";
import { CHARACTER_STEPS } from "./steps";
import { PreviewCard } from "@/components/create/PreviewCard";

export function WizardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentStepKey, canContinue, saving, goNext, goBack, submit, draft } =
    useCharacterWizard();
  const currentIndex = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
  const isLast = currentIndex === CHARACTER_STEPS.length - 1;

  async function handleFinish() {
    const result = await submit();
    if (result.ok) router.push(`/chat/${result.id}`);
    else alert(`Save failed: ${result.error}`);
  }

  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[1fr_320px]">
      <div>
        <ol className="mb-6 flex items-center gap-2 text-sm">
          {CHARACTER_STEPS.map((s, i) => (
            <li
              key={s.key}
              className="flex items-center gap-2"
              style={{
                color:
                  i === currentIndex
                    ? "hsl(var(--poppy-accent-rose))"
                    : i < currentIndex
                      ? "hsl(var(--poppy-fg))"
                      : "hsl(var(--poppy-muted))",
                fontWeight: i === currentIndex ? 600 : 400,
              }}
            >
              <span className="rounded-full border border-current px-2 py-0.5 text-xs">
                {i + 1}
              </span>
              {s.label}
              {i < CHARACTER_STEPS.length - 1 ? (
                <span style={{ color: "hsl(var(--poppy-border))" }}>-</span>
              ) : null}
            </li>
          ))}
        </ol>

        <div
          className="rounded-xl border p-6"
          style={{
            backgroundColor: "hsl(var(--poppy-surface))",
            borderColor: "hsl(var(--poppy-border))",
          }}
        >
          {children}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={currentIndex === 0}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: "hsl(var(--poppy-border))", color: "hsl(var(--poppy-fg))" }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={isLast ? handleFinish : goNext}
            disabled={!canContinue || (isLast && saving)}
            className="rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--poppy-accent-rose))",
              color: "hsl(var(--poppy-primary-fg))",
            }}
          >
            {isLast ? (saving ? "Saving..." : "Finish") : "Next"}
          </button>
        </div>
      </div>

      <aside>
        <div className="sticky top-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Live preview
          </h2>
          <PreviewCard draft={draft} />
        </div>
      </aside>
    </section>
  );
}
