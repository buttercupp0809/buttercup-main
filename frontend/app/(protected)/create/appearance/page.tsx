"use client";

import { Check } from "lucide-react";
import { useCharacterWizard } from "../context";
import { Chip } from "../Chip";
import {
  HAIR_OPTIONS,
  EYE_OPTIONS,
  BODY_OPTIONS,
  CLOTHING_OPTIONS,
  VIBE_OPTIONS,
} from "../options";

// Color swatches for each vibe to give the preview area visual identity
const VIBE_SWATCHES: Record<string, { color: string; gradient: string; accentColor: string }> = {
  "cinematic portrait, soft natural light": {
    color: "#c8b89a",
    gradient: "linear-gradient(135deg, #1a1510 0%, #2a2018 40%, #3a2e20 100%)",
    accentColor: "#d4b896",
  },
  "studio glamour shot, dramatic lighting": {
    color: "#e8c0a0",
    gradient: "linear-gradient(135deg, #1a0f0f 0%, #2e1818 40%, #3e2020 100%)",
    accentColor: "#e8a878",
  },
  "golden hour outdoors, warm tones": {
    color: "#f0c060",
    gradient: "linear-gradient(135deg, #1a1200 0%, #2e2008 40%, #403010 100%)",
    accentColor: "#f0c060",
  },
  "cozy indoor scene, shallow depth of field": {
    color: "#a0b8c8",
    gradient: "linear-gradient(135deg, #0f1a20 0%, #182430 40%, #203040 100%)",
    accentColor: "#90b0c8",
  },
  "neon city night, moody atmosphere": {
    color: "#c040f0",
    gradient: "linear-gradient(135deg, #0a0018 0%, #180828 40%, #280840 100%)",
    accentColor: "#c060f0",
  },
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-sm font-medium"
      style={{
        color: "hsl(var(--bc-fg))",
        borderLeft: "3px solid hsl(var(--bc-amber))",
        paddingLeft: "10px",
      }}
    >
      {children}
    </span>
  );
}

export default function AppearanceStep() {
  const { draft, updateDraft } = useCharacterWizard();
  const traits = draft.traits ?? {};

  function setTrait(k: "hair" | "eye" | "body" | "clothing", v: string) {
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
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Appearance</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Pick a look. These choices drive image generation later.
        </p>
      </div>

      {/* Look & lighting - visual option cards with color swatch */}
      <div className="flex flex-col gap-3">
        <SectionHeader>Look &amp; lighting</SectionHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {VIBE_OPTIONS.map((v) => {
            const selected = draft.stylePrompt === v.value;
            const swatch = VIBE_SWATCHES[v.value] ?? {
              color: "#888",
              gradient: "linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)",
              accentColor: "#aaa",
            };
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => updateDraft({ stylePrompt: v.value, traits })}
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
                {/* Color swatch preview area */}
                <div className="relative flex h-20 w-full items-start overflow-hidden p-3">
                  <div
                    className="h-10 w-10 rounded-lg opacity-90"
                    style={{
                      background: swatch.color,
                      boxShadow: `0 0 16px ${swatch.color}88, 0 4px 12px rgba(0,0,0,0.4)`,
                    }}
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
                  {/* Ambient glow behind swatch */}
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: `radial-gradient(circle at 25% 50%, ${swatch.color} 0%, transparent 60%)`,
                    }}
                  />
                </div>

                {/* Text content */}
                <div className="flex flex-col gap-0.5 p-3 pt-0">
                  <p
                    className="font-display text-sm font-semibold"
                    style={{ color: selected ? "hsl(var(--bc-honey))" : "hsl(var(--bc-fg))" }}
                  >
                    {v.label}
                  </p>
                  {v.hint && (
                    <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                      {v.hint}
                    </p>
                  )}
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

      {/* Hair */}
      <div className="flex flex-col gap-3">
        <SectionHeader>Hair</SectionHeader>
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
      </div>

      {/* Eyes */}
      <div className="flex flex-col gap-3">
        <SectionHeader>Eyes</SectionHeader>
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
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3">
        <SectionHeader>Body</SectionHeader>
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
      </div>

      {/* Outfit */}
      <div className="flex flex-col gap-3">
        <SectionHeader>Outfit</SectionHeader>
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
      </div>

      {/* Prompt preview - amber-bordered callout */}
      <div
        className="rounded-xl px-4 py-3 text-sm"
        style={{
          backgroundColor: "hsl(var(--bc-surface-2))",
          borderLeft: `3px solid hsl(var(--bc-amber))`,
          color: "hsl(var(--bc-muted))",
        }}
      >
        <span
          className="block text-xs font-medium uppercase tracking-wide"
          style={{ color: "hsl(var(--bc-amber))", marginBottom: "4px" }}
        >
          Image prompt preview
        </span>
        <span className="italic">
          {composedPreview || "(pick a look above)"}
        </span>
      </div>
    </div>
  );
}
