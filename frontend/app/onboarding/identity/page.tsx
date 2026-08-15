"use client";

import { useOnboardingWizard } from "../context";
import { ONBOARDING_GENDER_OPTIONS } from "@buttercupp/shared";

export default function OnboardingIdentityStep() {
  const { draft, updateDraft, fieldErrors } = useOnboardingWizard();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Welcome. What should we call you?</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          A quick intro so your companion greets you by name.
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
          Display name
        </span>
        <input
          data-testid="onboarding-display-name"
          value={draft.displayName ?? ""}
          onChange={(e) => updateDraft({ displayName: e.target.value })}
          maxLength={48}
          placeholder="What should we call you?"
          autoFocus
          className="w-full rounded-xl border px-4 py-3.5 text-base transition-all duration-150 focus:outline-none"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface-2))",
            color: "hsl(var(--buttercupp-fg))",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--buttercupp-accent-rose))";
            e.currentTarget.style.boxShadow = "0 0 0 3px hsl(var(--buttercupp-accent-rose) / 0.2)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--buttercupp-border))";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {fieldErrors.displayName ? (
          <span className="text-xs text-rose-400">{fieldErrors.displayName}</span>
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
          You identify as
        </span>
        <div className="grid grid-cols-2 gap-3">
          {ONBOARDING_GENDER_OPTIONS.map((g) => {
            const selected = draft.gender === g.value;
            return (
              <button
                key={g.value}
                type="button"
                data-testid={`onboarding-gender-${g.value}`}
                onClick={() => updateDraft({ gender: g.value })}
                aria-pressed={selected}
                className="flex min-h-[3.25rem] items-center justify-center rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors"
                style={
                  selected
                    ? {
                        borderColor: "hsl(var(--buttercupp-accent-rose))",
                        backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.15)",
                        color: "hsl(var(--buttercupp-fg))",
                      }
                    : {
                        borderColor: "hsl(var(--buttercupp-border))",
                        color: "hsl(var(--buttercupp-muted))",
                      }
                }
              >
                {g.label}
              </button>
            );
          })}
        </div>
        {fieldErrors.gender ? (
          <span className="text-xs text-rose-400">{fieldErrors.gender}</span>
        ) : null}
      </div>
    </div>
  );
}
