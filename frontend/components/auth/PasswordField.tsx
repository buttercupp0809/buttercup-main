"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PasswordChecklist } from "@/components/auth/PasswordChecklist";

// Controlled password input with a show/hide eye toggle. When
// `showChecklist` is set (signup, password reset), the strength checklist
// renders below and notifies the parent via `onValidityChange`.

export interface PasswordFieldProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete?: string;
  required?: boolean;
  showChecklist?: boolean;
  onValidityChange?: (valid: boolean) => void;
  helperText?: string;
  id?: string;
}

export function PasswordField({
  value,
  onChange,
  label,
  autoComplete = "current-password",
  required = true,
  showChecklist = false,
  onValidityChange,
  helperText,
  id,
}: PasswordFieldProps) {
  const [visible, setVisible] = React.useState(false);
  // Track validity so the checklist can REVEAL only while the user is typing
  // an invalid password, and collapse again once every requirement passes.
  const [valid, setValid] = React.useState(false);
  const reactId = React.useId();
  const inputId = id ?? reactId;

  const handleValidity = React.useCallback(
    (v: boolean) => {
      setValid(v);
      onValidityChange?.(v);
    },
    [onValidityChange],
  );

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={inputId} className="text-sm">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          className={cn(
            "w-full rounded-md border px-3 py-2 pr-10",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
          )}
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface))",
            color: "hsl(var(--buttercupp-fg))",
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-2 flex items-center rounded p-1 text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-slate-200"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {helperText ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{helperText}</p>
      ) : null}
      {/*
        Reveal logic: the checklist is only VISIBLE while the user is typing an
        invalid password. It is kept mounted (via `hidden`) when empty or valid
        so PasswordChecklist keeps computing and reporting validity, but it
        collapses out of view once every rule passes. When valid we show a
        single confirmation line instead of the full list.
      */}
      {showChecklist ? (
        <>
          <div hidden={value.length === 0 || valid}>
            <PasswordChecklist value={value} onValidityChange={handleValidity} />
          </div>
          {value.length > 0 && valid ? (
            <p className="text-xs" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>
              Password meets every requirement.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.9 19.9 0 0 1 4.2-5.19" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
