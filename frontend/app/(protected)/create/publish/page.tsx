"use client";

import { useCharacterWizard } from "../context";

const VISIBILITY_CARDS = [
  {
    value: "private" as const,
    label: "Private",
    emoji: "🔒",
    hint: "Only you can chat with them",
    gradient: "linear-gradient(135deg, #050d1a 0%, #0d1a2e 40%, #142238 100%)",
    accentColor: "#80a8d0",
  },
  {
    value: "public" as const,
    label: "Public",
    emoji: "🌍",
    hint: "Appears in Discover after moderation",
    gradient: "linear-gradient(135deg, #0f0520 0%, #1a0d38 40%, #220e48 100%)",
    accentColor: "#b090e0",
  },
];

const RATING_CARDS = [
  {
    value: "sfw" as const,
    label: "Standard",
    emoji: "☀️",
    hint: "Safe for work, general audience",
    gradient: "linear-gradient(135deg, #0a1a10 0%, #12261a 40%, #163422 100%)",
    accentColor: "#90d8b0",
  },
  {
    value: "mature" as const,
    label: "Mature",
    emoji: "🔥",
    hint: "18+ content, hidden from general browsing",
    gradient: "linear-gradient(135deg, #1a0a0a 0%, #2e1212 40%, #3a1414 100%)",
    accentColor: "#e89090",
  },
];

function RichCard<T extends string>({
  card,
  selected,
  onClick,
}: {
  card: { value: T; label: string; emoji: string; hint: string; gradient: string; accentColor: string };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-200"
      style={{
        background: card.gradient,
        border: selected
          ? `2px solid hsl(var(--buttercupp-accent-rose))`
          : "2px solid rgba(255,255,255,0.08)",
        boxShadow: selected
          ? `0 0 0 1px hsl(var(--buttercupp-accent-rose) / 0.3), 0 8px 32px rgba(0,0,0,0.4)`
          : "0 4px 16px rgba(0,0,0,0.3)",
        transform: selected ? "translateY(-2px)" : undefined,
      }}
    >
      {/* Large emoji preview area */}
      <div
        className="relative flex h-28 w-full items-center justify-center overflow-hidden"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 40%, ${card.accentColor}22 0%, transparent 70%)`,
        }}
      >
        <span className="text-5xl">{card.emoji}</span>
        {selected && (
          <div
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background:
                "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
              color: "#ffffff",
            }}
          >
            ✓
          </div>
        )}
      </div>

      {/* Text content */}
      <div className="flex flex-col gap-0.5 p-4 pt-2">
        <p
          className="font-display text-sm font-semibold"
          style={{ color: selected ? card.accentColor : "rgba(255,255,255,0.9)" }}
        >
          {card.label}
        </p>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
          {card.hint}
        </p>
      </div>

      {selected && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
          }}
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
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Last step. Choose who can see your companion.
        </p>
      </div>

      {/* Visibility */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
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
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
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
          backgroundColor: "hsl(var(--buttercupp-surface-2))",
          border: `1px solid hsl(var(--buttercupp-border))`,
          borderLeft: `3px solid hsl(var(--buttercupp-accent-violet))`,
          color: "hsl(var(--buttercupp-muted))",
        }}
      >
        <span className="mt-0.5 text-base">ℹ️</span>
        <span>
          Clicking{" "}
          <span style={{ color: "hsl(var(--buttercupp-fg))", fontWeight: 500 }}>Finish</span>{" "}
          saves your companion and drops you straight into a chat.
        </span>
      </div>
    </div>
  );
}
