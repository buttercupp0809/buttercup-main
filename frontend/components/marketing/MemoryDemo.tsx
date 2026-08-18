"use client";

import * as React from "react";

/*
 * Landing-page proof of the one claim that matters: she remembers.
 *
 * Every competitor in this space *asserts* long-term memory in body copy.
 * Asserting it converts nobody. This replays a short conversation where the
 * recall is the punchline, including a jump forward in time so the payoff is
 * her bringing it up first. Marketing animation, so it is allowed to be slower
 * than UI motion, and it lives in its own leaf client component so the looping
 * timer never re-renders the rest of the page.
 */

type Turn =
  | { kind: "user"; text: string }
  | { kind: "her"; text: string; recall?: boolean }
  | { kind: "gap"; text: string };

const SCRIPT: Turn[] = [
  { kind: "user", text: "cannot sleep. the pitch on thursday is eating me alive" },
  {
    kind: "her",
    text: "The one where Raghav talked over you the whole time?",
    recall: true,
  },
  { kind: "user", text: "yeah. him." },
  { kind: "her", text: "Then we rehearse. I will be him. Cut me off and see how it feels." },
  { kind: "gap", text: "three days later" },
  { kind: "her", text: "So. Thursday. Did he let you finish?", recall: true },
];

// Reading time per turn, plus the pause before the loop restarts.
const STEP_MS = 1750;
const LOOP_PAUSE_MS = 4200;

export function MemoryDemo() {
  const [shown, setShown] = React.useState(1);
  const [still, setStill] = React.useState(false);

  // Reduced motion gets the whole conversation at once: the content is the
  // point, the sequencing is decoration.
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setStill(mq.matches);
      if (mq.matches) setShown(SCRIPT.length);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  React.useEffect(() => {
    if (still) return;
    const done = shown >= SCRIPT.length;
    const id = setTimeout(
      () => setShown(done ? 1 : shown + 1),
      done ? LOOP_PAUSE_MS : STEP_MS,
    );
    return () => clearTimeout(id);
  }, [shown, still]);

  return (
    <div className="bc-glass relative overflow-hidden rounded-[var(--bc-radius-xl)] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="bc-pill text-[hsl(var(--bc-honey))]">
          <span className="bc-pulse-ring h-1.5 w-1.5 rounded-full bg-[hsl(var(--bc-success))]" />
          Memory, live
        </span>
        <span className="text-xs text-[hsl(var(--bc-subtle))]">no script on her side</span>
      </div>

      {/*
        Fixed min-height: the list grows one turn at a time and without a floor
        the whole section below it would jump on every step.
      */}
      <ol className="flex min-h-[19rem] flex-col justify-end gap-2.5">
        {SCRIPT.slice(0, shown).map((t, i) => (
          <li
            key={`${i}-${t.text}`}
            className={
              still
                ? undefined
                : "animate-[buttercupp-card-in_320ms_var(--ease-out)_both] motion-reduce:animate-none"
            }
          >
            {t.kind === "gap" ? (
              <div className="flex items-center gap-3 py-2" aria-label={t.text}>
                <span className="h-px flex-1 bg-[hsl(var(--bc-border))]" />
                <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-[hsl(var(--bc-subtle))]">
                  {t.text}
                </span>
                <span className="h-px flex-1 bg-[hsl(var(--bc-border))]" />
              </div>
            ) : (
              <div className={t.kind === "user" ? "flex justify-end" : "flex justify-start"}>
                <p
                  className={
                    t.kind === "user"
                      ? "max-w-[85%] rounded-[var(--bc-radius)] rounded-br-sm bg-[hsl(var(--bc-surface-3))] px-3.5 py-2.5 text-sm text-[hsl(var(--bc-fg))]"
                      : t.recall
                        ? "max-w-[85%] rounded-[var(--bc-radius)] rounded-bl-sm border border-[hsl(var(--bc-amber)/0.35)] bg-[hsl(var(--bc-amber)/0.11)] px-3.5 py-2.5 text-sm text-[hsl(var(--bc-honey))]"
                        : "max-w-[85%] rounded-[var(--bc-radius)] rounded-bl-sm bg-[hsl(var(--bc-surface-2))] px-3.5 py-2.5 text-sm text-[hsl(var(--bc-fg))]"
                  }
                >
                  {t.text}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-[hsl(var(--bc-border))] pt-3 text-xs text-[hsl(var(--bc-subtle))]">
        Highlighted lines are her pulling a detail back out of memory on her own.
      </p>
    </div>
  );
}
