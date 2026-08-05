"use client";

import * as React from "react";
import { useCharacterWizard } from "../context";
import { Chip, OptionCard, FieldGroup } from "../Chip";
import { ARCHETYPES, TRAIT_OPTIONS, VOICE_OPTIONS } from "../options";

export default function PersonalityStep() {
  const { draft, updateDraft } = useCharacterWizard();
  const tags = draft.traitTags ?? [];
  const voice = draft.voiceProfile;
  const [showDetails, setShowDetails] = React.useState(false);

  const activeArchetype = ARCHETYPES.find((a) => a.fill.backstory === draft.backstory);

  function pickArchetype(key: string) {
    const arch = ARCHETYPES.find((a) => a.key === key);
    if (!arch) return;
    updateDraft({
      bio: arch.fill.bio,
      backstory: arch.fill.backstory,
      behavioralInstructions: arch.fill.behavioralInstructions,
      greeting: arch.fill.greeting,
      // Only seed trait tags if the user has not chosen their own yet.
      traitTags: tags.length > 0 ? tags : arch.fill.traitTags,
    });
  }

  function toggleTag(t: string) {
    if (tags.includes(t)) {
      updateDraft({ traitTags: tags.filter((x) => x !== t) });
    } else if (tags.length < 15) {
      updateDraft({ traitTags: [...tags, t] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Personality</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Pick a personality to start. One tap fills everything.
        </p>
      </div>

      <FieldGroup title="Archetype">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ARCHETYPES.map((a) => (
            <OptionCard
              key={a.key}
              label={a.label}
              hint={a.hint}
              selected={activeArchetype?.key === a.key}
              onClick={() => pickArchetype(a.key)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Personality traits">
        <div className="flex flex-wrap gap-2">
          {TRAIT_OPTIONS.map((t) => (
            <Chip key={t} label={t} selected={tags.includes(t)} onClick={() => toggleTag(t)} />
          ))}
        </div>
        <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {tags.length > 0 ? `${tags.length} selected` : "Pick at least one"}
        </span>
      </FieldGroup>

      <FieldGroup title="Voice">
        <div className="flex flex-wrap gap-2">
          {VOICE_OPTIONS.map((v) => (
            <Chip
              key={`${v.provider}:${v.voiceId}`}
              label={v.label}
              selected={voice?.provider === v.provider && voice?.voiceId === v.voiceId}
              onClick={() => updateDraft({ voiceProfile: { provider: v.provider, voiceId: v.voiceId } })}
            />
          ))}
        </div>
      </FieldGroup>

      {activeArchetype ? (
        <div
          className="rounded-md p-3 text-xs"
          style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))", color: "hsl(var(--buttercupp-muted))" }}
        >
          <span style={{ color: "hsl(var(--buttercupp-fg))" }}>First message: </span>
          <span className="italic">{draft.greeting}</span>
        </div>
      ) : null}

      {/* Power-user escape hatch: everything above is optional to touch, but a
          user who wants to hand-write the details can reveal the fields. */}
      <div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="cursor-pointer text-xs underline"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          {showDetails ? "Hide details" : "Fine-tune details (optional)"}
        </button>
        {showDetails ? (
          <div className="mt-3 flex flex-col gap-3">
            <DetailField
              label="Bio"
              value={draft.bio ?? ""}
              onChange={(v) => updateDraft({ bio: v })}
              maxLength={280}
            />
            <DetailArea
              label="Backstory"
              value={draft.backstory ?? ""}
              onChange={(v) => updateDraft({ backstory: v })}
              rows={4}
            />
            <DetailArea
              label="Behavioral instructions"
              value={draft.behavioralInstructions ?? ""}
              onChange={(v) => updateDraft({ behavioralInstructions: v })}
              rows={3}
            />
            <DetailField
              label="Greeting"
              value={draft.greeting ?? ""}
              onChange={(v) => updateDraft({ greeting: v })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputStyle = {
  borderColor: "hsl(var(--buttercupp-border))",
  backgroundColor: "hsl(var(--buttercupp-surface-2))",
  color: "hsl(var(--buttercupp-fg))",
} as const;

function DetailField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ color: "hsl(var(--buttercupp-muted))" }}>{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
      />
    </label>
  );
}

function DetailArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ color: "hsl(var(--buttercupp-muted))" }}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
      />
    </label>
  );
}
