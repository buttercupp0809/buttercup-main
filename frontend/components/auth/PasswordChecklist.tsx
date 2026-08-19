"use client";

import * as React from "react";
import { Check, Circle } from "lucide-react";
import { passwordChecklist, PASSWORD_RULES } from "@buttercupp/shared";
import { cn } from "@/lib/utils";

// Real-time password-strength UI. Pulls the rule set from @buttercupp/shared so
// there is exactly one definition of what makes a password strong. Each row
// carries its pass/fail state to assistive tech via role + aria-label so we
// do not rely on color alone.

export interface PasswordChecklistProps {
  value: string;
  onValidityChange?: (valid: boolean) => void;
  className?: string;
}

export function PasswordChecklist({ value, onValidityChange, className }: PasswordChecklistProps) {
  const results = React.useMemo(() => passwordChecklist(value), [value]);
  const passed = results.filter((r) => r.ok).length;
  const total = PASSWORD_RULES.length;
  const allPass = passed === total;

  React.useEffect(() => {
    onValidityChange?.(allPass);
  }, [allPass, onValidityChange]);

  const strengthPct = Math.round((passed / total) * 100);
  // Strength ramp is semantic (weak to strong), tied to the amber/success tokens
  // so it stays in-palette. The mid band is the brand amber; the strong band is
  // the success green.
  const barColor =
    passed <= 1
      ? "bg-[hsl(var(--bc-danger))]"
      : passed <= 3
      ? "bg-[hsl(var(--bc-amber))]"
      : passed === total - 1
      ? "bg-[hsl(var(--bc-honey))]"
      : "bg-[hsl(var(--bc-success))]";
  const label =
    passed <= 1 ? "Weak" : passed <= 3 ? "Fair" : passed === total ? "Strong" : "Good";

  return (
    <div
      className={cn("mt-2 flex flex-col gap-2 text-xs", className)}
      aria-live="polite"
      data-testid="password-checklist"
    >
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--bc-surface-3))]">
          <div
            className={cn("h-full transition-all", barColor)}
            style={{ width: `${strengthPct}%` }}
            aria-hidden
          />
        </div>
        <span className="w-12 text-right font-medium text-[hsl(var(--bc-muted))]">{label}</span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {results.map((r) => (
          <li
            key={r.id}
            role="status"
            aria-label={`${r.label}: ${r.ok ? "passed" : "not yet"}`}
            className={cn(
              "flex items-center gap-2",
              r.ok ? "text-[hsl(var(--bc-success))]" : "text-[hsl(var(--bc-subtle))]",
            )}
          >
            {r.ok ? <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden /> : <Circle className="h-4 w-4 shrink-0" aria-hidden />}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
