"use client";

import { useCharacterWizard } from "../context";
import { Chip, FieldGroup } from "../Chip";
import { GENDER_OPTIONS, AGE_OPTIONS, NAME_SUGGESTIONS } from "../options";

const GENDER_CARDS: {
  value: string;
  label: string;
  emoji: string;
  hint: string;
  gradient: string;
  accentColor: string;
}[] = [
  {
    value: "Female",
    label: "Female",
    emoji: "👩",
    hint: "Feminine identity",
    gradient: "linear-gradient(135deg, #2a0a1e 0%, #3d1a2e 40%, #5a1a3a 100%)",
    accentColor: "#f0a0c0",
  },
  {
    value: "Male",
    label: "Male",
    emoji: "👨",
    hint: "Masculine identity",
    gradient: "linear-gradient(135deg, #0a1a2e 0%, #1a2e42 40%, #1a3a5a 100%)",
    accentColor: "#a0c4f0",
  },
  {
    value: "Non-binary",
    label: "Non-binary",
    emoji: "🧑",
    hint: "Beyond the binary",
    gradient: "linear-gradient(135deg, #1a1a2a 0%, #2a2a3e 40%, #3a2a4e 100%)",
    accentColor: "#c0b0e0",
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
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Tap to choose. You can tweak anything later.
        </p>
      </div>

      {/* Gender - rich visual cards */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
            paddingLeft: "10px",
          }}
        >
          Gender
        </span>
        <div className="grid grid-cols-3 gap-3">
          {GENDER_CARDS.map((g) => {
            const selected = gender === g.value;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => updateDraft({ gender: g.value })}
                className="group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-200"
                style={{
                  background: g.gradient,
                  border: selected
                    ? `2px solid hsl(var(--buttercupp-accent-rose))`
                    : "2px solid rgba(255,255,255,0.08)",
                  boxShadow: selected
                    ? `0 0 0 1px hsl(var(--buttercupp-accent-rose) / 0.3), 0 8px 32px rgba(0,0,0,0.4)`
                    : "0 4px 16px rgba(0,0,0,0.3)",
                  transform: selected ? "translateY(-2px)" : undefined,
                }}
              >
                {/* Emoji preview area */}
                <div
                  className="relative flex h-24 w-full items-center justify-center overflow-hidden"
                  style={{
                    backgroundImage: `radial-gradient(circle at 50% 40%, ${g.accentColor}22 0%, transparent 70%)`,
                  }}
                >
                  <span className="text-4xl">{g.emoji}</span>
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
                <div className="flex flex-col gap-0.5 p-3">
                  <p
                    className="font-display text-sm font-semibold"
                    style={{ color: selected ? g.accentColor : "rgba(255,255,255,0.9)" }}
                  >
                    {g.label}
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {g.hint}
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
          })}
        </div>
      </div>

      {/* Age - styled pills */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
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
          <span className="text-xs text-rose-400">{fieldErrors.age}</span>
        ) : null}
      </div>

      {/* Name - styled input + suggestions */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
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
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface-2))",
            color: "hsl(var(--buttercupp-fg))",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--buttercupp-accent-rose))";
            e.currentTarget.style.boxShadow =
              "0 0 0 3px hsl(var(--buttercupp-accent-rose) / 0.2)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--buttercupp-border))";
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
          <span className="text-xs text-rose-400">{fieldErrors.name}</span>
        ) : null}
      </div>
    </div>
  );
}
