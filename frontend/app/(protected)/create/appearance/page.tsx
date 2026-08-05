"use client";

import { useCharacterWizard } from "../context";
import { Chip, OptionCard, FieldGroup } from "../Chip";
import {
  HAIR_OPTIONS,
  EYE_OPTIONS,
  BODY_OPTIONS,
  CLOTHING_OPTIONS,
  VIBE_OPTIONS,
} from "../options";

export default function AppearanceStep() {
  const { draft, updateDraft } = useCharacterWizard();
  const traits = draft.traits ?? {};

  function setTrait(k: "hair" | "eye" | "body" | "clothing", v: string) {
    // Toggle off if the same chip is tapped again.
    const next = traits[k] === v ? undefined : v;
    updateDraft({ traits: { ...traits, [k]: next } });
  }

  const composedPreview = [
    draft.stylePrompt,
    traits.hair,
    traits.eye,
    traits.body,
    traits.clothing && `wearing ${traits.clothing}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Appearance</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
          Pick a look. These choices drive image generation later.
        </p>
      </div>

      <FieldGroup title="Look & lighting">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {VIBE_OPTIONS.map((v) => (
            <OptionCard
              key={v.value}
              label={v.label}
              hint={v.hint}
              selected={draft.stylePrompt === v.value}
              // Seed `traits` so the step validates even if the user picks
              // only a vibe and no individual trait chips.
              onClick={() => updateDraft({ stylePrompt: v.value, traits })}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Hair">
        <div className="flex flex-wrap gap-2">
          {HAIR_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={traits.hair === o.value}
              onClick={() => setTrait("hair", o.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Eyes">
        <div className="flex flex-wrap gap-2">
          {EYE_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={traits.eye === o.value}
              onClick={() => setTrait("eye", o.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Body">
        <div className="flex flex-wrap gap-2">
          {BODY_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={traits.body === o.value}
              onClick={() => setTrait("body", o.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Outfit">
        <div className="flex flex-wrap gap-2">
          {CLOTHING_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={traits.clothing === o.value}
              onClick={() => setTrait("clothing", o.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <div
        className="rounded-md p-3 text-xs"
        style={{ backgroundColor: "hsl(var(--poppy-surface-2))", color: "hsl(var(--poppy-muted))" }}
      >
        Image prompt preview: <span className="italic">{composedPreview || "(pick a look above)"}</span>
      </div>
    </div>
  );
}
