"use client";

import Link from "next/link";
import { Check, UserRound, User, UsersRound, CircleHelp, type LucideIcon } from "lucide-react";
import { useOnboardingWizard } from "../context";
import { ONBOARDING_GENDER_OPTIONS } from "@buttercupp/shared";
import { TRUST_CHIPS } from "@/components/trust/copy";

// Tasteful icon per gender value. Kept local so the shared options list stays a
// pure data source and the visuals live with the view.
const GENDER_ICON: Record<string, LucideIcon> = {
  woman: UserRound,
  man: User,
  nonbinary: UsersRound,
  prefer_not: CircleHelp,
};

export default function OnboardingIdentityStep() {
  const { draft, updateDraft } = useOnboardingWizard();

  const trimmedName = (draft.displayName ?? "").trim();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Welcome. What should we call you?</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          A gentle first hello, so your companion greets you by name.
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
          borderColor: "hsl(var(--bc-amber) / 0.3)",
          background:
            "linear-gradient(135deg, hsl(var(--bc-amber) / 0.1), hsl(var(--bc-honey) / 0.05))",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "hsl(var(--bc-amber) / 0.18)",
              border: "1px solid hsl(var(--bc-amber) / 0.35)",
              color: "hsl(var(--bc-honey))",
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
            <p className="text-sm font-semibold" style={{ color: "hsl(var(--bc-fg))" }}>
              Before we begin, a promise.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              What you tell us stays with you. Your companion, your chats, and your account are locked and private. We do not sell your data and we do not use your private chats to train other AIs.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {TRUST_CHIPS.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: "hsl(var(--bc-border))",
                    color: "hsl(var(--bc-fg))",
                    background: "hsl(var(--bc-surface-2) / 0.6)",
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
              style={{ color: "hsl(var(--bc-honey))" }}
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
            color: "hsl(var(--bc-fg))",
            borderLeft: "3px solid hsl(var(--bc-amber))",
            paddingLeft: "10px",
          }}
        >
          Display name <span style={{ color: "hsl(var(--bc-danger))" }}>*</span>
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
            borderColor: "hsl(var(--bc-border))",
            backgroundColor: "hsl(var(--bc-surface-2))",
            color: "hsl(var(--bc-fg))",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--bc-amber))";
            e.currentTarget.style.boxShadow = "0 0 0 3px hsl(var(--bc-amber) / 0.2)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "hsl(var(--bc-border))";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {trimmedName ? (
          <p
            className="motion-safe:bc-rise text-sm"
            style={{ color: "hsl(var(--bc-honey))" }}
          >
            Lovely to meet you, {trimmedName}.
          </p>
        ) : null}
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
          You identify as <span style={{ color: "hsl(var(--bc-danger))" }}>*</span>
        </span>
        <div className="grid grid-cols-2 gap-3">
          {ONBOARDING_GENDER_OPTIONS.map((g, index) => {
            const selected = draft.gender === g.value;
            const Icon = GENDER_ICON[g.value];
            return (
              <button
                key={g.value}
                type="button"
                data-testid={`onboarding-gender-${g.value}`}
                onClick={() => updateDraft({ gender: g.value })}
                aria-pressed={selected}
                style={{
                  // CSS custom property for the staggered entrance animation.
                  ["--i" as unknown as string]: index,
                  borderColor: selected
                    ? "hsl(var(--bc-amber))"
                    : "hsl(var(--bc-border))",
                  backgroundColor: selected
                    ? "hsl(var(--bc-amber) / 0.12)"
                    : "hsl(var(--bc-surface-2))",
                  boxShadow: selected
                    ? "0 0 0 1px hsl(var(--bc-amber) / 0.35), 0 8px 24px -8px hsl(var(--bc-amber) / 0.35)"
                    : "none",
                }}
                className="bc-press motion-safe:bc-rise relative flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-xl border px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5"
              >
                {selected ? (
                  <span
                    className="motion-safe:bc-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: "hsl(var(--bc-amber))",
                      color: "hsl(28 45% 9%)",
                    }}
                    aria-hidden
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : null}
                {Icon ? (
                  <Icon
                    className="h-6 w-6"
                    aria-hidden
                    style={{ color: "hsl(var(--bc-honey))" }}
                  />
                ) : null}
                <span
                  className="font-semibold"
                  style={{ color: "hsl(var(--bc-fg))" }}
                >
                  {g.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
