import { Check } from "lucide-react";
import type { DailyQuest } from "@/lib/progress";
import { cn } from "@/lib/utils";

// Today's three quests. Server-safe.
//
// Rows are separated by hairlines rather than boxed into cards: three nested
// cards inside a panel is the "card overuse" tell, and dividers keep the group
// reading as one object. Partial progress renders as a fraction (4/10) so the
// unfinished quest still shows movement, which is what makes it feel worth
// finishing rather than binary and abandoned.

export function DailyQuests({
  quests,
  className,
}: {
  quests: DailyQuest[];
  className?: string;
}) {
  if (quests.length === 0) return null;
  const done = quests.filter((q) => q.done).length;
  const allDone = done === quests.length;

  return (
    <section className={cn("buttercupp-glass rounded-[var(--bc-radius-xl)] p-5", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold tracking-tight text-[hsl(var(--bc-fg))]">
          Today
        </h2>
        <span className="tabular text-xs text-[hsl(var(--bc-subtle))]">
          {done} of {quests.length}
        </span>
      </header>

      <ul className="mt-3 divide-y" style={{ borderColor: "hsl(var(--bc-border))" }}>
        {quests.map((q, i) => (
          <li
            key={q.id}
            className="bc-rise flex items-center gap-3 py-3 first:pt-1 last:pb-1"
            style={{ "--i": i } as React.CSSProperties}
          >
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-200"
              style={
                q.done
                  ? {
                      borderColor: "transparent",
                      background: "var(--bc-gradient-brand)",
                    }
                  : {
                      borderColor: "hsl(var(--bc-border-strong))",
                      background: "transparent",
                    }
              }
            >
              {q.done ? (
                <Check className="size-3.5" strokeWidth={3} style={{ color: "hsl(28 45% 12%)" }} />
              ) : null}
            </span>

            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm font-medium",
                  q.done ? "text-[hsl(var(--bc-subtle))]" : "text-[hsl(var(--bc-fg))]",
                )}
              >
                {q.label}
              </span>
              {!q.done ? (
                <span className="mt-0.5 block text-xs text-[hsl(var(--bc-subtle))]">{q.hint}</span>
              ) : null}
            </span>

            {q.goal > 1 && !q.done ? (
              <span className="tabular shrink-0 text-xs text-[hsl(var(--bc-muted))]">
                {q.progress}/{q.goal}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {allDone ? (
        <p className="mt-3 text-xs text-[hsl(var(--bc-honey))]">
          All done for today. Anything else is just because you want to.
        </p>
      ) : null}
    </section>
  );
}
