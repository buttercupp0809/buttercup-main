"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useOnboardingWizard } from "../context";
import { Button } from "@/components/ui/button";

export default function OnboardingFinishStep() {
  const router = useRouter();
  const { draft, saving, submit } = useOnboardingWizard();
  const [error, setError] = React.useState<string | null>(null);

  async function handleFinish() {
    setError(null);
    const result = await submit();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(result.firstCharacterId ? `/chat/${result.firstCharacterId}` : "/dashboard");
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.25), hsl(var(--buttercupp-accent-violet) / 0.25))",
          }}
        >
          ✨
        </div>
        <h1 className="font-display text-2xl font-semibold">
          Welcome, {draft.displayName || "friend"}
        </h1>
        <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {draft.firstCharacterId
            ? "Your companion is ready to meet you."
            : "ButterCupp is ready. Browse the gallery whenever you like."}
        </p>
      </div>

      {error ? (
        <p className="text-center text-sm" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        data-testid="onboarding-finish"
        onClick={handleFinish}
        disabled={saving}
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
        }}
      >
        {saving ? "Entering..." : "Enter ButterCupp"}
      </Button>
    </div>
  );
}
