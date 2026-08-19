"use client";

// Controlled tab primitive. Follows the CVA + Tailwind + CSS-variable pattern
// used by `button.tsx` and `Modal.tsx`. Accessible: the list has role
// "tablist"; each trigger is a role="tab" button with `aria-selected` and
// `aria-controls`; the panel is role="tabpanel". Keyboard navigation on the
// tab strip supports ArrowLeft / ArrowRight (with wrap), Home, and End.
//
// The component is intentionally controlled (value + onValueChange) so
// consumers own the URL, storage, and reset semantics.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tabsListVariants = cva(
  "inline-flex items-center gap-1 rounded-2xl border p-1",
  {
    variants: {
      variant: {
        default: [
          "border-[hsl(var(--buttercupp-border))]",
          "bg-[hsl(var(--buttercupp-surface)/0.6)]",
          "backdrop-blur-md",
        ].join(" "),
      },
      size: {
        default: "text-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const tabsTriggerVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      state: {
        // Active: gradient pill that mirrors the primary Button variant, so
        // the tab strip visually matches the rest of the surface's CTAs.
        active: [
          "text-white shadow-[0_8px_24px_-12px_hsl(344_84%_71%/0.55)]",
          "bg-[linear-gradient(90deg,hsl(344_84%_71%),hsl(262_72%_68%))]",
        ].join(" "),
        // Inactive: muted foreground that lifts on hover, so the whole strip
        // still reads as a single control instead of two disconnected buttons.
        inactive: [
          "text-[hsl(var(--buttercupp-muted))]",
          "hover:text-[hsl(var(--buttercupp-fg))]",
          "hover:bg-[hsl(var(--buttercupp-surface-2)/0.8)]",
        ].join(" "),
      },
    },
    defaultVariants: { state: "inactive" },
  },
);

export interface TabItem<TValue extends string = string> {
  value: TValue;
  label: React.ReactNode;
  disabled?: boolean;
  // Optional test id forwarded to the trigger button. When omitted, we do
  // not stamp a `data-testid` (callers can still pass one via extraProps).
  testId?: string;
}

export interface TabsProps<TValue extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">,
    VariantProps<typeof tabsListVariants> {
  value: TValue;
  onValueChange: (value: TValue) => void;
  items: ReadonlyArray<TabItem<TValue>>;
  // Optional stable id used to link tab triggers to their panels. If the
  // caller does not provide one, we generate one so `aria-controls` still
  // points at a real (caller-owned) panel via the same id contract.
  idBase?: string;
  ariaLabel?: string;
}

export function Tabs<TValue extends string = string>({
  value,
  onValueChange,
  items,
  idBase,
  ariaLabel,
  variant,
  size,
  className,
  ...rest
}: TabsProps<TValue>) {
  const reactId = React.useId();
  const base = idBase ?? `tabs-${reactId}`;
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const enabledIndexes = React.useMemo(
    () => items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0),
    [items],
  );

  function focusIndex(index: number) {
    const el = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
    el?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (enabledIndexes.length === 0) return;
    const currentIdx = items.findIndex((it) => it.value === value);
    const pos = enabledIndexes.indexOf(currentIdx);
    let nextPos = pos;
    switch (e.key) {
      case "ArrowRight":
        nextPos = pos < 0 ? 0 : (pos + 1) % enabledIndexes.length;
        break;
      case "ArrowLeft":
        nextPos =
          pos < 0
            ? enabledIndexes.length - 1
            : (pos - 1 + enabledIndexes.length) % enabledIndexes.length;
        break;
      case "Home":
        nextPos = 0;
        break;
      case "End":
        nextPos = enabledIndexes.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextIdx = enabledIndexes[nextPos];
    const nextItem = items[nextIdx];
    if (nextItem) {
      onValueChange(nextItem.value);
      focusIndex(nextIdx);
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...rest}
    >
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${base}-tab-${item.value}`}
            aria-selected={isActive}
            aria-controls={`${base}-panel-${item.value}`}
            tabIndex={isActive ? 0 : -1}
            disabled={item.disabled}
            data-testid={item.testId}
            data-state={isActive ? "active" : "inactive"}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
            className={cn(tabsTriggerVariants({ state: isActive ? "active" : "inactive" }))}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabsPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  activeValue: string;
  idBase: string;
}

// Optional companion for consumers that want the panel wiring handled. We do
// not require callers to use it (they can render their own div and pass the
// matching `id` / `aria-labelledby` themselves).
export function TabsPanel({
  value,
  activeValue,
  idBase,
  hidden,
  className,
  children,
  ...rest
}: TabsPanelProps) {
  const isActive = value === activeValue;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      hidden={hidden ?? !isActive}
      className={className}
      {...rest}
    >
      {isActive ? children : null}
    </div>
  );
}
