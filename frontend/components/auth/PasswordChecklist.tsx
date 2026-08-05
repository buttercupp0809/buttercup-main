"use client";

import * as React from "react";
import { passwordChecklist, PASSWORD_RULES } from "@poppy/shared";
import { cn } from "@/lib/utils";

// Real-time password-strength UI. Pulls the rule set from @poppy/shared so
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
  const barColor =
    passed <= 1
      ? "bg-red-500"
      : passed <= 3
      ? "bg-amber-500"
      : passed === total - 1
      ? "bg-lime-500"
      : "bg-emerald-500";
  const label =
    passed <= 1 ? "Weak" : passed <= 3 ? "Fair" : passed === total ? "Strong" : "Good";

  return (
    <div
      className={cn("mt-2 flex flex-col gap-2 text-xs", className)}
      aria-live="polite"
      data-testid="password-checklist"
    >
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={cn("h-full transition-all", barColor)}
            style={{ width: `${strengthPct}%` }}
            aria-hidden
          />
        </div>
        <span className="w-12 text-right font-medium text-slate-600 dark:text-slate-300">{label}</span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {results.map((r) => (
          <li
            key={r.id}
            role="status"
            aria-label={`${r.label}: ${r.ok ? "passed" : "not yet"}`}
            className={cn(
              "flex items-center gap-2",
              r.ok ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400",
            )}
          >
            {r.ok ? <CheckIcon /> : <DotIcon />}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}
