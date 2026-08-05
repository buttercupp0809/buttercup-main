"use client";

import { useCharacterWizard } from "../context";
import { Chip, FieldGroup } from "../Chip";
import { GENDER_OPTIONS, AGE_OPTIONS, NAME_SUGGESTIONS } from "../options";

export default function IdentityStep() {
  const { draft, updateDraft, fieldErrors } = useCharacterWizard();
  const gender = draft.gender ?? "";
  const suggestions = NAME_SUGGESTIONS[gender] ?? NAME_SUGGESTIONS.Female;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Identity</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
          Tap to choose. You can tweak anything later.
        </p>
      </div>

      <FieldGroup title="Gender">
        <div className="flex flex-wrap gap-2">
          {GENDER_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={gender === o.value}
              onClick={() => updateDraft({ gender: o.value })}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Age (18+)">
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
        {fieldErrors.age ? <span className="text-xs text-rose-400">{fieldErrors.age}</span> : null}
      </FieldGroup>

      <FieldGroup title="Name">
        <input
          value={draft.name ?? ""}
          onChange={(e) => updateDraft({ name: e.target.value })}
          maxLength={64}
          placeholder="Pick a suggestion or type your own"
          className="rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          style={{
            borderColor: "hsl(var(--poppy-border))",
            backgroundColor: "hsl(var(--poppy-surface-2))",
            color: "hsl(var(--poppy-fg))",
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
        {fieldErrors.name ? <span className="text-xs text-rose-400">{fieldErrors.name}</span> : null}
      </FieldGroup>
    </div>
  );
}
