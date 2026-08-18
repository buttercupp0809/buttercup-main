import { Flame } from "lucide-react";
import type { StreakResult } from "@/lib/bond";
import { cn } from "@/lib/utils";

// Streak display. Server-safe.
//
// Three states, and the copy for each is deliberate:
//
//   safe     already showed up today. Celebrate, then get out of the way.
//   at risk  streak alive but today is still open. This is the only state that
//            earns a nudge, and it stays a statement of fact rather than a
//            threat, because guilt-driven retention is exactly what makes these
//            products feel predatory.
//   cold     no active run. Offered as an invitation, never as a loss.
//
// The grace day is surfaced explicitly rather than hidden. A forgiveness
// mechanic the user cannot see just reads as a buggy counter; named, it becomes
// a feature that makes the streak feel survivable.

export function StreakBadge({
  streak,
  className,
}: {
  streak: StreakResult;
  className?: string;
}) {
  const cold = streak.current === 0;

  return (
    <div
      className={cn("bc-glass flex items-center gap-3 rounded-[var(--bc-radius-lg)] p-3", className)}
    >
      <span
        className="relative grid size-11 shrink-0 place-items-center rounded-[var(--bc-radius)]"
        style={{
          background: cold ? "hsl(var(--bc-surface-3))" : "var(--bc-gradient-brand)",
        }}
      >
        <Flame
          className="size-5"
          strokeWidth={2}
          style={{ color: cold ? "hsl(var(--bc-subtle))" : "hsl(28 45% 12%)" }}
          aria-hidden="true"
        />
      </span>

      <div className="min-w-0">
        <p className="flex items-baseline gap-1.5">
          <span className="tabular font-display text-xl font-semibold leading-none text-[hsl(var(--bc-fg))]">
            {streak.current}
          </span>
          <span className="text-xs text-[hsl(var(--bc-muted))]">
            {streak.current === 1 ? "day" : "days"}
          </span>
          {streak.usedGrace ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium"
              style={{
                backgroundColor: "hsl(var(--bc-honey) / 0.14)",
                color: "hsl(var(--bc-honey))",
              }}
              title="A missed day was forgiven, so your streak survived."
            >
              grace used
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--bc-subtle))]">
          {cold
            ? "Start a streak today"
            : streak.atRisk
              ? "Say hi to keep it going"
              : streak.best > streak.current
                ? `Best run ${streak.best} days`
                : "Personal best, right now"}
        </p>
      </div>
    </div>
  );
}
