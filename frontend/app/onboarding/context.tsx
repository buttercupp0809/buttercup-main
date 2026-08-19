"use client";

// Onboarding wizard state provider. Cloned from ../(protected)/create/context.tsx
// almost verbatim, retargeted to onboarding: same React-state + localStorage
// draft mirror, hydrate-then-render pattern, and step navigation. submit()
// calls the completeOnboarding Server Action instead of a fetch.

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { ONBOARDING_DRAFT_STORAGE_KEY, type OnboardingDraft } from "@buttercupp/shared";
import { ONBOARDING_STEPS, getStep, validateStep, type OnboardingStepKey } from "./steps";
import { completeOnboarding } from "./actions";

interface OnboardingWizardContextValue {
  draft: OnboardingDraft;
  hydrated: boolean;
  currentStepKey: OnboardingStepKey;
  updateDraft: (patch: OnboardingDraft) => void;
  canContinue: boolean;
  fieldErrors: Record<string, string>;
  saving: boolean;
  goNext: () => void;
  goBack: () => void;
  submit: () => Promise<
    { ok: true; firstCharacterId: string | null } | { ok: false; error: string }
  >;
  reset: () => void;
}

const Ctx = React.createContext<OnboardingWizardContextValue | null>(null);

function stepKeyFromPath(pathname: string): OnboardingStepKey {
  const match = ONBOARDING_STEPS.find((s) => pathname.startsWith(s.path));
  return (match?.key ?? "identity") as OnboardingStepKey;
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = React.useState<OnboardingDraft>({});
  const [hydrated, setHydrated] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Synchronous mirror of `saving` used by submit()'s re-entry guard. A state
  // read inside the callback can be stale across rapid double-clicks; a ref is
  // updated and read synchronously so the second call sees the in-flight flag.
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
      if (raw) setDraft(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // storage disabled/quota exceeded
    }
  }, [draft, hydrated]);

  const currentStepKey = stepKeyFromPath(pathname ?? "");
  const step = getStep(currentStepKey);
  const validation = validateStep(step, draft);

  const updateDraft = React.useCallback((patch: OnboardingDraft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const goNext = React.useCallback(() => {
    if (!validation.ok) return;
    const idx = ONBOARDING_STEPS.findIndex((s) => s.key === currentStepKey);
    const next = ONBOARDING_STEPS[idx + 1];
    if (next) router.push(next.path);
  }, [validation.ok, currentStepKey, router]);

  const goBack = React.useCallback(() => {
    const idx = ONBOARDING_STEPS.findIndex((s) => s.key === currentStepKey);
    const prev = ONBOARDING_STEPS[idx - 1];
    if (prev) router.push(prev.path);
  }, [currentStepKey, router]);

  const submit = React.useCallback(async (): Promise<
    { ok: true; firstCharacterId: string | null } | { ok: false; error: string }
  > => {
    // Re-entry guard: if a submit is already in flight, no-op. Without this a
    // second click during the (5-10s) post-success redirect window could fire
    // completeOnboarding again against a partially-cleared local draft.
    if (savingRef.current) {
      return { ok: false, error: "already_submitting" };
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await completeOnboarding(draft);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      // The server has persisted onboarding, so the localStorage draft is no
      // longer needed. We remove the persisted copy but deliberately do NOT
      // clear the in-memory `draft`: clearing it here would re-render the
      // finish page's summary as empty while router.push() is still pending
      // (the finish page keeps showing until navigation completes), and a
      // second click would then submit an empty draft that fails Zod. The
      // component unmounts on navigation, so the stale draft is harmless.
      try {
        window.localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
      return { ok: true, firstCharacterId: result.firstCharacterId ?? null };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft]);

  const reset = React.useCallback(() => {
    setDraft({});
    try {
      window.localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value: OnboardingWizardContextValue = {
    draft,
    hydrated,
    currentStepKey,
    updateDraft,
    canContinue: validation.ok,
    fieldErrors: validation.fieldErrors,
    saving,
    goNext,
    goBack,
    submit,
    reset,
  };

  if (!hydrated) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboardingWizard(): OnboardingWizardContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useOnboardingWizard requires an OnboardingProvider");
  return v;
}
