"use client";

import * as React from "react";
import {
  Flower2,
  Palette,
  Crown,
  Gamepad2,
  Heart,
  Compass,
  Sparkles,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useCharacterWizard } from "../context";
import { Chip, FieldGroup } from "../Chip";
import { ARCHETYPES, TRAIT_OPTIONS, VOICE_OPTIONS } from "../options";

// Icon per archetype key. Card chrome is themed by the amber system, so the
// only per-archetype dressing kept here is the icon.
const ARCHETYPE_META: Record<string, { icon: LucideIcon }> = {
  "girl-next-door": { icon: Flower2 },
  "mysterious-artist": { icon: Palette },
  "confident-executive": { icon: Crown },
  "playful-gamer": { icon: Gamepad2 },
  "caring-companion": { icon: Heart },
  "adventurous-traveler": { icon: Compass },
};

const ARCHETYPE_FALLBACK = { icon: Sparkles };

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
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Personality</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Pick a personality to start. One tap fills everything.
        </p>
      </div>

      {/* Archetype - amber option cards */}
      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Archetype
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ARCHETYPES.map((a) => {
            const selected = activeArchetype?.key === a.key;
            const meta = ARCHETYPE_META[a.key] ?? ARCHETYPE_FALLBACK;
            const ArchetypeIcon = meta.icon;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => pickArchetype(a.key)}
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
                  className="relative flex h-20 w-full items-center justify-center overflow-hidden"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 50% 40%, hsl(var(--bc-amber) / 0.14) 0%, transparent 70%)",
                  }}
                >
                  <ArchetypeIcon
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
                    {a.label}
                  </p>
                  <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                    {a.hint}
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

      {/* Personality traits with count badge */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{
              color: "hsl(var(--bc-fg))",
              borderLeft: "3px solid hsl(var(--bc-amber))",
              paddingLeft: "10px",
            }}
          >
            Personality traits
          </span>
          {tags.length > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: "hsl(var(--bc-amber) / 0.15)",
                color: "hsl(var(--bc-amber))",
                border: "1px solid hsl(var(--bc-amber) / 0.3)",
              }}
            >
              {tags.length} / 15
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {TRAIT_OPTIONS.map((t) => (
            <Chip key={t} label={t} selected={tags.includes(t)} onClick={() => toggleTag(t)} />
          ))}
        </div>
        <span className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
          {tags.length > 0 ? `${tags.length} selected` : "Pick at least one"}
        </span>
      </div>

      {/* Voice */}
      <FieldGroup title="Voice">
        <div className="flex flex-wrap gap-2">
          {VOICE_OPTIONS.map((v) => (
            <Chip
              key={`${v.provider}:${v.voiceId}`}
              label={v.label}
              selected={voice?.provider === v.provider && voice?.voiceId === v.voiceId}
              onClick={() =>
                updateDraft({ voiceProfile: { provider: v.provider, voiceId: v.voiceId } })
              }
            />
          ))}
        </div>
      </FieldGroup>

      {/* First message preview - chat bubble style */}
      {activeArchetype ? (
        <div className="flex flex-col gap-2">
          <span
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: "hsl(var(--bc-amber))" }}
          >
            First message
          </span>
          <div
            className="relative rounded-2xl rounded-tl-sm px-4 py-3 text-sm"
            style={{
              backgroundColor: "hsl(var(--bc-surface-2))",
              border: `1px solid hsl(var(--bc-amber) / 0.25)`,
              color: "hsl(var(--bc-fg))",
            }}
          >
            {/* Chat bubble tail */}
            <div
              className="absolute -left-1.5 top-3 h-3 w-3 rotate-45"
              style={{ backgroundColor: "hsl(var(--bc-surface-2))" }}
            />
            <span className="italic">{draft.greeting}</span>
          </div>
        </div>
      ) : null}

      {/* Fine-tune details escape hatch */}
      <div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="cursor-pointer text-xs underline"
          style={{ color: "hsl(var(--bc-muted))" }}
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
  borderColor: "hsl(var(--bc-border))",
  backgroundColor: "hsl(var(--bc-surface-2))",
  color: "hsl(var(--bc-fg))",
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
      <span style={{ color: "hsl(var(--bc-muted))" }}>{label}</span>
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
      <span style={{ color: "hsl(var(--bc-muted))" }}>{label}</span>
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
