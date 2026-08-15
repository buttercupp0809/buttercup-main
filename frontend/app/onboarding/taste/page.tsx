"use client";

import { useOnboardingWizard } from "../context";
import { ONBOARDING_VIBE_OPTIONS, ONBOARDING_INTEREST_SUGGESTIONS } from "@buttercupp/shared";

export default function OnboardingTasteStep() {
  const { draft, updateDraft, fieldErrors } = useOnboardingWizard();
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
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          This shapes the personality and vibe your companion brings.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
            paddingLeft: "10px",
          }}
        >
          Pick a vibe
        </span>
        <div className="grid grid-cols-1 gap-3">
          {ONBOARDING_VIBE_OPTIONS.map((v) => {
            const selected = draft.vibe === v.value;
            return (
              <button
                key={v.value}
                type="button"
                data-testid={`onboarding-vibe-${v.value}`}
                onClick={() => updateDraft({ vibe: v.value })}
                aria-pressed={selected}
                className="flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3.5 text-left transition-colors"
                style={
                  selected
                    ? {
                        borderColor: "hsl(var(--buttercupp-accent-rose))",
                        backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.12)",
                      }
                    : { borderColor: "hsl(var(--buttercupp-border))" }
                }
              >
                <span className="text-sm font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
                  {v.label}
                </span>
                <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                  {v.hint}
                </span>
              </button>
            );
          })}
        </div>
        {fieldErrors.vibe ? <span className="text-xs text-rose-400">{fieldErrors.vibe}</span> : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{
              color: "hsl(var(--buttercupp-fg))",
              borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
              paddingLeft: "10px",
            }}
          >
            Interests
          </span>
          {interests.length > 0 ? (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: "hsl(var(--buttercupp-accent-rose) / 0.15)",
                color: "hsl(var(--buttercupp-accent-rose))",
                border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.3)",
              }}
            >
              {interests.length} / 8
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {ONBOARDING_INTEREST_SUGGESTIONS.map((t) => {
            const selected = interests.includes(t);
            return (
              <button
                key={t}
                type="button"
                data-testid={`onboarding-interest-${t}`}
                onClick={() => toggleInterest(t)}
                aria-pressed={selected}
                className="cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors"
                style={
                  selected
                    ? {
                        borderColor: "hsl(var(--buttercupp-accent-rose))",
                        backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.15)",
                        color: "hsl(var(--buttercupp-fg))",
                      }
                    : { borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }
                }
              >
                {t}
              </button>
            );
          })}
        </div>
        <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {interests.length > 0 ? `${interests.length} selected` : "Pick at least one"}
        </span>
        {fieldErrors.interests ? (
          <span className="text-xs text-rose-400">{fieldErrors.interests}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <span
          className="text-sm font-medium"
          style={{
            color: "hsl(var(--buttercupp-fg))",
            borderLeft: "3px solid hsl(var(--buttercupp-accent-rose))",
            paddingLeft: "10px",
          }}
        >
          What do you want from a companion?
        </span>
        <textarea
          data-testid="onboarding-companion-goal"
          value={draft.companionGoal ?? ""}
          onChange={(e) => updateDraft({ companionGoal: e.target.value })}
          maxLength={280}
          rows={3}
          placeholder="Someone to talk to at the end of the day, a creative partner, a bit of fun..."
          className="w-full rounded-xl border px-4 py-3 text-sm transition-all duration-150 focus:outline-none"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface-2))",
            color: "hsl(var(--buttercupp-fg))",
          }}
        />
        {fieldErrors.companionGoal ? (
          <span className="text-xs text-rose-400">{fieldErrors.companionGoal}</span>
        ) : null}
      </div>
    </div>
  );
}
