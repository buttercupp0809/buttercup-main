"use client";

import Link from "next/link";
import { useOnboardingWizard } from "../context";
import { ONBOARDING_GENDER_OPTIONS } from "@buttercupp/shared";
import { TRUST_CHIPS } from "@/components/trust/copy";

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

      {/*
        Trust callout: the first thing a user sees before typing their name.
        Deliberately soft (no scary shield icon, no jargon). Chips are pulled
        from the shared TRUST_CHIPS source so wording never drifts from the
        marketing home or the auth strip.
      */}
      <div
        className="rounded-xl border p-4"
        style={{
          borderColor: "hsl(var(--buttercupp-accent-rose) / 0.35)",
          background:
            "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.06), hsl(var(--buttercupp-accent-violet) / 0.06))",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.2), hsl(var(--buttercupp-accent-violet) / 0.2))",
              border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.35)",
              color: "hsl(var(--buttercupp-accent-rose))",
            }}
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
              Before we begin, a promise.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              What you tell us stays with you. Your companion, your chats, and your account are locked and private. We do not sell your data and we do not use your private chats to train other AIs.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {TRUST_CHIPS.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: "hsl(var(--buttercupp-border))",
                    color: "hsl(var(--buttercupp-fg))",
                    background: "hsl(var(--buttercupp-surface-2) / 0.6)",
                  }}
                >
                  {c.label}
                </span>
              ))}
            </div>
            <Link
              href="/legal/privacy-promise"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-[11px] underline underline-offset-2"
              style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
            >
              Read the full privacy promise
            </Link>
          </div>
        </div>
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
