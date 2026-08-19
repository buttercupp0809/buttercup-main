"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
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
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]",
          )}
          style={{
            borderColor: "hsl(var(--bc-border))",
            backgroundColor: "hsl(var(--bc-surface-2))",
            color: "hsl(var(--bc-fg))",
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-2 flex items-center rounded p-1 text-[hsl(var(--bc-subtle))] hover:text-[hsl(var(--bc-fg))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
        >
          {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
        </button>
      </div>
      {helperText ? (
        <p className="text-xs text-[hsl(var(--bc-muted))]">{helperText}</p>
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
            <p className="text-xs" style={{ color: "hsl(var(--bc-success))" }}>
              Password meets every requirement.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
