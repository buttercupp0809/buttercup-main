"use client";

import { Lock, Globe, Sun, Flame, Check, Info, type LucideIcon } from "lucide-react";
import { useCharacterWizard } from "../context";

const VISIBILITY_CARDS = [
  {
    value: "private" as const,
    label: "Private",
    icon: Lock,
    hint: "Only you can chat with them",
  },
  {
    value: "public" as const,
    label: "Public",
    icon: Globe,
    hint: "Appears in Discover after moderation",
  },
];

const RATING_CARDS = [
  {
    value: "sfw" as const,
    label: "Standard",
    icon: Sun,
    hint: "Safe for work, general audience",
  },
  {
    value: "mature" as const,
    label: "Mature",
    icon: Flame,
    hint: "18+ content, hidden from general browsing",
  },
];

function RichCard<T extends string>({
  card,
  selected,
  onClick,
}: {
  card: { value: T; label: string; icon: LucideIcon; hint: string };
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = card.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-200"
      style={{
        backgroundColor: selected
          ? "hsl(var(--bc-amber) / 0.12)"
          : "hsl(var(--bc-surface-2))",
        border: selected
          ? "2px solid hsl(var(--bc-amber))"
          : "2px solid hsl(var(--bc-border))",
        boxShadow: selected ? "var(--bc-shadow-glow)" : "var(--bc-shadow)",
        transform: selected ? "translateY(-2px)" : undefined,
      }}
    >
      {/* Large emoji preview area */}
      <div
        className="relative flex h-28 w-full items-center justify-center overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 40%, hsl(var(--bc-amber) / 0.14) 0%, transparent 70%)",
        }}
      >
        <Icon
          className="h-8 w-8"
          aria-hidden
          style={{ color: "hsl(var(--bc-honey))" }}
        />
        {selected && (
          <div
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: "hsl(var(--bc-amber))",
              color: "hsl(28 45% 9%)",
            }}
          >
            <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </div>
        )}
      </div>

      {/* Text content */}
      <div className="flex flex-col gap-0.5 p-4 pt-2">
        <p
          className="font-display text-sm font-semibold"
          style={{ color: selected ? "hsl(var(--bc-honey))" : "hsl(var(--bc-fg))" }}
        >
          {card.label}
        </p>
        <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
          {card.hint}
        </p>
      </div>

      {selected && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ background: "var(--bc-gradient-brand-h)" }}
        />
      )}
    </button>
  );
}

export default function PublishStep() {
  const { draft, updateDraft } = useCharacterWizard();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Publish</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Last step. Choose who can see your companion.
        </p>
      </div>

      {/* Visibility */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Visibility
        </span>
        <div className="grid grid-cols-2 gap-3">
          {VISIBILITY_CARDS.map((card) => (
            <RichCard
              key={card.value}
              card={card}
              selected={draft.visibility === card.value}
              onClick={() => updateDraft({ visibility: card.value })}
            />
          ))}
        </div>
      </div>

      {/* Content rating */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Content rating
        </span>
        <div className="grid grid-cols-2 gap-3">
          {RATING_CARDS.map((card) => (
            <RichCard
              key={card.value}
              card={card}
              selected={draft.contentRating === card.value}
              onClick={() => updateDraft({ contentRating: card.value })}
            />
          ))}
        </div>
      </div>

      {/* Info callout */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
        style={{
          backgroundColor: "hsl(var(--bc-surface-2))",
          border: `1px solid hsl(var(--bc-border))`,
          borderLeft: `3px solid hsl(var(--bc-amber))`,
          color: "hsl(var(--bc-muted))",
        }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden style={{ color: "hsl(var(--bc-amber))" }} />
        <span>
          Clicking{" "}
          <span style={{ color: "hsl(var(--bc-fg))", fontWeight: 500 }}>Finish</span>{" "}
          saves your companion and drops you straight into a chat.
        </span>
      </div>
    </div>
  );
}
