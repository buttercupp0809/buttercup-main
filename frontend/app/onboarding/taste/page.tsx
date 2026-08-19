"use client";

import {
  Check,
  Coffee,
  Flame,
  Compass,
  BookOpen,
  HeartHandshake,
  Clapperboard,
  Music,
  Gamepad2,
  Dumbbell,
  ChefHat,
  Plane,
  Palette,
  Rocket,
  Flower2,
  Shirt,
  Mountain,
  type LucideIcon,
} from "lucide-react";
import { useOnboardingWizard } from "../context";
import { ONBOARDING_VIBE_OPTIONS, ONBOARDING_INTEREST_SUGGESTIONS } from "@buttercupp/shared";

// Icon per vibe value. Keyed by the shared option `value` so labels/copy can
// change upstream without breaking the icon mapping.
const VIBE_ICON: Record<string, LucideIcon> = {
  cozy: Coffee,
  flirty: Flame,
  adventurous: Compass,
  intellectual: BookOpen,
  supportive: HeartHandshake,
};

// Icon per interest label. Keyed by the raw label string that lives in the
// shared suggestions list (never the icon, so stored values stay plain text).
const INTEREST_ICON: Record<string, LucideIcon> = {
  Movies: Clapperboard,
  Music: Music,
  Gaming: Gamepad2,
  Reading: BookOpen,
  Fitness: Dumbbell,
  Cooking: ChefHat,
  Travel: Plane,
  Art: Palette,
  "Sci-fi": Rocket,
  Anime: Flower2,
  Fashion: Shirt,
  Outdoors: Mountain,
};

export default function OnboardingTasteStep() {
  const { draft, updateDraft } = useOnboardingWizard();
  const interests = draft.interests ?? [];

  function toggleInterest(t: string) {
    if (interests.includes(t)) {
      updateDraft({ interests: interests.filter((x) => x !== t) });
    } else if (interests.length < 8) {
      updateDraft({ interests: [...interests, t] });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">What are you into?</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          A few taps and your companion starts to feel like yours.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Pick a vibe <span style={{ color: "hsl(var(--bc-danger))" }}>*</span>
        </span>
        <div className="flex flex-col gap-3">
          {ONBOARDING_VIBE_OPTIONS.map((v, index) => {
            const selected = draft.vibe === v.value;
            const Icon = VIBE_ICON[v.value];
            return (
              <button
                key={v.value}
                type="button"
                data-testid={`onboarding-vibe-${v.value}`}
                onClick={() => updateDraft({ vibe: v.value })}
                aria-pressed={selected}
                style={{
                  // CSS custom property for the staggered entrance animation.
                  ["--i" as unknown as string]: index,
                  ...(selected
                    ? {
                        borderColor: "hsl(var(--bc-amber))",
                        backgroundColor: "hsl(var(--bc-amber) / 0.12)",
                        boxShadow:
                          "0 0 0 1px hsl(var(--bc-amber) / 0.35), 0 8px 24px -8px hsl(var(--bc-amber) / 0.35)",
                      }
                    : {
                        borderColor: "hsl(var(--bc-border))",
                        backgroundColor: "hsl(var(--bc-surface-2))",
                      }),
                }}
                className="relative flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 bc-press hover:-translate-y-0.5 motion-safe:bc-rise"
              >
                {Icon ? (
                  <Icon
                    className="h-6 w-6"
                    aria-hidden
                    style={{ color: "hsl(var(--bc-honey))" }}
                  />
                ) : null}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold" style={{ color: "hsl(var(--bc-fg))" }}>
                    {v.label}
                  </span>
                  <span className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
                    {v.hint}
                  </span>
                </span>
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="motion-safe:bc-pop absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: "hsl(var(--bc-amber))",
                      color: "hsl(28 45% 9%)",
                    }}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

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
            Interests <span style={{ color: "hsl(var(--bc-danger))" }}>*</span>
          </span>
          {interests.length > 0 ? (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: "hsl(var(--bc-amber) / 0.15)",
                color: "hsl(var(--bc-honey))",
                border: "1px solid hsl(var(--bc-amber) / 0.3)",
              }}
            >
              {interests.length} / 8
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {ONBOARDING_INTEREST_SUGGESTIONS.map((t) => {
            const selected = interests.includes(t);
            const Icon = INTEREST_ICON[t];
            return (
              <button
                key={t}
                type="button"
                data-testid={`onboarding-interest-${t}`}
                onClick={() => toggleInterest(t)}
                aria-pressed={selected}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm bc-press transition-colors"
                style={
                  selected
                    ? {
                        borderColor: "hsl(var(--bc-amber))",
                        backgroundColor: "hsl(var(--bc-amber) / 0.15)",
                        color: "hsl(var(--bc-fg))",
                      }
                    : { borderColor: "hsl(var(--bc-border))", color: "hsl(var(--bc-muted))" }
                }
              >
                {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                {t}
              </button>
            );
          })}
        </div>
        <span className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
          {interests.length > 0 ? `${interests.length} selected` : "Pick at least one"}
        </span>
      </div>
    </div>
  );
}
