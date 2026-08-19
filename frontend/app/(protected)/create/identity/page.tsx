"use client";

import { UserRound, User, UsersRound, Check, type LucideIcon } from "lucide-react";
import { useCharacterWizard } from "../context";
import { Chip } from "../Chip";
import { AGE_OPTIONS, NAME_SUGGESTIONS } from "../options";

const GENDER_CARDS: {
  value: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  {
    value: "Female",
    label: "Female",
    icon: UserRound,
    hint: "Feminine identity",
  },
  {
    value: "Male",
    label: "Male",
    icon: User,
    hint: "Masculine identity",
  },
  {
    value: "Non-binary",
    label: "Non-binary",
    icon: UsersRound,
    hint: "Beyond the binary",
  },
];

export default function IdentityStep() {
  const { draft, updateDraft, fieldErrors } = useCharacterWizard();
  const gender = draft.gender ?? "";
  const suggestions = NAME_SUGGESTIONS[gender] ?? NAME_SUGGESTIONS.Female;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Identity</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Tap to choose. You can tweak anything later.
        </p>
      </div>

      {/* Gender - amber option cards */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Gender
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {GENDER_CARDS.map((g) => {
            const selected = gender === g.value;
            const Icon = g.icon;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => updateDraft({ gender: g.value })}
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
                {/* Emoji preview area */}
                <div
                  className="relative flex h-24 w-full items-center justify-center overflow-hidden"
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
                <div className="flex flex-col gap-0.5 p-3">
                  <p
                    className="font-display text-sm font-semibold"
                    style={{ color: selected ? "hsl(var(--bc-honey))" : "hsl(var(--bc-fg))" }}
                  >
                    {g.label}
                  </p>
                  <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                    {g.hint}
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
          })}
        </div>
      </div>

      {/* Age - styled pills */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Age (18+)
        </span>
        <div className="flex flex-wrap gap-2">
          {AGE_OPTIONS.map((a) => (
            <Chip
              key={a}
              label={String(a)}
              selected={draft.age === a}
              onClick={() => updateDraft({ age: a })}
            />
          ))}
        </div>
        {fieldErrors.age ? (
          <span className="text-xs" style={{ color: "hsl(var(--bc-danger))" }}>
            {fieldErrors.age}
          </span>
        ) : null}
      </div>

      {/* Name - styled input + suggestions */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Name
        </span>
        <input
          value={draft.name ?? ""}
          onChange={(e) => updateDraft({ name: e.target.value })}
          maxLength={64}
          placeholder="Pick a suggestion or type your own"
          className="w-full rounded-xl border px-4 py-3 text-sm transition-all duration-150 focus:outline-none"
          style={{
            borderColor: "hsl(var(--bc-border))",
            backgroundColor: "hsl(var(--bc-surface-2))",
            color: "hsl(var(--bc-fg))",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--bc-amber))";
            e.currentTarget.style.boxShadow = "0 0 0 3px hsl(var(--bc-amber) / 0.2)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--bc-border))";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <div className="flex flex-wrap gap-2">
          {suggestions.map((n) => (
            <Chip
              key={n}
              label={n}
              selected={draft.name === n}
              onClick={() => updateDraft({ name: n })}
            />
          ))}
        </div>
        {fieldErrors.name ? (
          <span className="text-xs" style={{ color: "hsl(var(--bc-danger))" }}>
            {fieldErrors.name}
          </span>
        ) : null}
      </div>
    </div>
  );
}
