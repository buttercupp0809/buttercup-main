"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ONBOARDING_VIBE_OPTIONS } from "@buttercupp/shared";
import { useOnboardingWizard } from "../context";
import { Button } from "@/components/ui/button";

export default function OnboardingFinishStep() {
  const router = useRouter();
  const { draft, saving, submit } = useOnboardingWizard();
  const [error, setError] = React.useState<string | null>(null);
  // Set true right before router.push and NEVER reset: the component unmounts
  // on navigation, so this latches the button disabled for the whole (5-10s)
  // redirect window and blocks a second submit of the now-persisted draft.
  const [redirecting, setRedirecting] = React.useState(false);

  async function handleFinish() {
    if (saving || redirecting) return;
    setError(null);
    const result = await submit();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRedirecting(true);
    router.push(result.firstCharacterId ? `/chat/${result.firstCharacterId}` : "/dashboard");
  }

  // Read back the vibe as its human label (guard for undefined).
  const vibeLabel = draft.vibe
    ? ONBOARDING_VIBE_OPTIONS.find((o) => o.value === draft.vibe)?.label
    : undefined;

  // Up to 4 chosen interests, guarded for undefined/empty.
  const interests = (draft.interests ?? []).slice(0, 4);

  // Build the ordered list of summary rows so each can stagger in via bc-rise.
  // Each entry carries its own React node; we assign --i by array position.
  const summaryRows: React.ReactNode[] = [];

  if (vibeLabel) {
    summaryRows.push(
      <div
        key="vibe"
        className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
        style={{
          backgroundColor: "hsl(var(--bc-surface-2))",
          border: "1px solid hsl(var(--bc-border))",
        }}
      >
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "hsl(var(--bc-subtle))" }}
        >
          Your vibe
        </span>
        <span
          className="rounded-full px-3 py-1 text-sm font-medium"
          style={{
            backgroundColor: "hsl(var(--bc-amber) / 0.15)",
            color: "hsl(var(--bc-amber-hot))",
            border: "1px solid hsl(var(--bc-amber) / 0.3)",
          }}
        >
          {vibeLabel}
        </span>
      </div>,
    );
  }

  if (interests.length > 0) {
    summaryRows.push(
      <div
        key="interests"
        className="flex flex-col gap-2 rounded-xl px-4 py-3"
        style={{
          backgroundColor: "hsl(var(--bc-surface-2))",
          border: "1px solid hsl(var(--bc-border))",
        }}
      >
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "hsl(var(--bc-subtle))" }}
        >
          You love
        </span>
        <div className="flex flex-wrap gap-2">
          {interests.map((interest) => (
            <span
              key={interest}
              className="rounded-full px-3 py-1 text-sm"
              style={{
                backgroundColor: "hsl(var(--bc-amber) / 0.12)",
                color: "hsl(var(--bc-amber-hot))",
                border: "1px solid hsl(var(--bc-amber) / 0.25)",
              }}
            >
              {interest}
            </span>
          ))}
        </div>
      </div>,
    );
  }

  summaryRows.push(
    <p
      key="companion"
      className="px-1 text-center text-sm"
      style={{ color: "hsl(var(--bc-muted))" }}
    >
      {draft.firstCharacterId
        ? "Your companion is ready to meet you."
        : "Browse the gallery whenever you like."}
    </p>,
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="bc-celebrate flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bc-amber) / 0.25), hsl(var(--bc-honey) / 0.25))",
            border: "1px solid hsl(var(--bc-amber) / 0.3)",
          }}
        >
          <Sparkles
            className="h-8 w-8"
            aria-hidden
            style={{ color: "hsl(var(--bc-honey))" }}
          />
        </div>
        <h1 className="font-display text-2xl font-semibold">
          Welcome, {draft.displayName || "friend"}
        </h1>
        <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
          Here is what your companion will know about you.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {summaryRows.map((row, index) => (
          <div
            key={(row as React.ReactElement).key ?? index}
            className="motion-safe:bc-rise"
            style={{ ["--i" as unknown as string]: index }}
          >
            {row}
          </div>
        ))}
      </div>

      {error ? (
        <p className="text-center text-sm" style={{ color: "hsl(var(--bc-danger))" }}>
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="brand"
        size="lg"
        data-testid="onboarding-finish"
        onClick={handleFinish}
        disabled={saving || redirecting}
      >
        {saving || redirecting ? "Entering..." : "Enter ButterCupp"}
      </Button>
    </div>
  );
}
