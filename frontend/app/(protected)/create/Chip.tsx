"use client";

// Shared click-select primitives for the wizard. Token-themed to match the
// dark app shell. Chip = compact pill (single/multi select); OptionCard = a
// larger box with a title + hint (used for style, vibe, archetype).

import { cn } from "@/lib/utils";

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        selected ? "font-medium" : "hover:bg-white/5",
      )}
      style={
        selected
          ? {
              borderColor: "hsl(var(--poppy-accent-rose))",
              backgroundColor: "hsl(var(--poppy-accent-rose) / 0.15)",
              color: "hsl(var(--poppy-fg))",
            }
          : {
              borderColor: "hsl(var(--poppy-border))",
              color: "hsl(var(--poppy-muted))",
            }
      }
    >
      {label}
    </button>
  );
}

export function OptionCard({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors",
        !selected && "hover:bg-white/5",
      )}
      style={
        selected
          ? {
              borderColor: "hsl(var(--poppy-accent-rose))",
              backgroundColor: "hsl(var(--poppy-accent-rose) / 0.12)",
            }
          : { borderColor: "hsl(var(--poppy-border))" }
      }
    >
      <span className="text-sm font-medium" style={{ color: "hsl(var(--poppy-fg))" }}>
        {label}
      </span>
      {hint ? (
        <span className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}

// A labelled group wrapper so each pick reads as one clear question.
export function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" style={{ color: "hsl(var(--poppy-fg))" }}>
        {title}
      </span>
      {children}
    </div>
  );
}
