"use client";

// Wizard state provider. Holds the draft in React state + mirrors it to
// localStorage so a reload preserves work. Hydrates from storage on mount;
// renders children only once hydrated so the server-rendered shell does not
// flicker back to defaults.

import * as React from "react";
import {
  CHARACTER_DRAFT_STORAGE_KEY,
  type CharacterDraft,
  type CreateCharacterInput,
} from "@buttercupp/shared";
import { CHARACTER_STEPS, getStep, validateStep, type StepKey } from "./steps";
import { useRouter, usePathname } from "next/navigation";

interface WizardContextValue {
  draft: CharacterDraft;
  hydrated: boolean;
  currentStepKey: StepKey;
  updateDraft: (patch: CharacterDraft) => void;
  canContinue: boolean;
  fieldErrors: Record<string, string>;
  saving: boolean;
  goNext: () => void;
  goBack: () => void;
  submit: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  reset: () => void;
}

const Ctx = React.createContext<WizardContextValue | null>(null);

// Never persist raw File blobs. Everything referenced by the wizard is a
// serializable string/number/nested object; File uploads are converted to a
// server-side key by the avatar route before they land in the draft.
function sanitizeForStorage(draft: CharacterDraft): CharacterDraft {
  return draft;
}

function stepKeyFromPath(pathname: string): StepKey {
  const match = CHARACTER_STEPS.find((s) => pathname.startsWith(s.path));
  return (match?.key ?? "style") as StepKey;
}

export function CharacterWizardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = React.useState<CharacterDraft>({});
  const [hydrated, setHydrated] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHARACTER_DRAFT_STORAGE_KEY);
      if (raw) setDraft(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        CHARACTER_DRAFT_STORAGE_KEY,
        JSON.stringify(sanitizeForStorage(draft)),
      );
    } catch {
      // storage disabled/quota exceeded
    }
  }, [draft, hydrated]);

  const currentStepKey = stepKeyFromPath(pathname ?? "");
  const step = getStep(currentStepKey);
  const validation = validateStep(step, draft);

  const updateDraft = React.useCallback((patch: CharacterDraft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const goNext = React.useCallback(() => {
    if (!validation.ok) return;
    const idx = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
    const next = CHARACTER_STEPS[idx + 1];
    if (next) router.push(next.path);
  }, [validation.ok, currentStepKey, router]);

  const goBack = React.useCallback(() => {
    const idx = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
    const prev = CHARACTER_STEPS[idx - 1];
    if (prev) router.push(prev.path);
  }, [currentStepKey, router]);

  const submit = React.useCallback(async (): Promise<
    { ok: true; id: string } | { ok: false; error: string }
  > => {
    setSaving(true);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft as CreateCharacterInput),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? `http_${res.status}` };
      }
      const body = (await res.json()) as { id: string };
      // If the user chose public, run publish (moderation gate) now.
      if (draft.visibility === "public") {
        await fetch(`/api/characters/${body.id}/publish`, { method: "POST" }).catch(() => null);
      }
      // Fire image generation in the background. Non-blocking: the GPU may be
      // offline and the pipeline fails gracefully in that case.
      fetch(`/api/characters/${body.id}/generate-images`, { method: "POST" }).catch(() => null);
      try {
        window.localStorage.removeItem(CHARACTER_DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
      setDraft({});
      return { ok: true, id: body.id };
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const reset = React.useCallback(() => {
    setDraft({});
    try {
      window.localStorage.removeItem(CHARACTER_DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value: WizardContextValue = {
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

export function useCharacterWizard(): WizardContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useCharacterWizard requires a CharacterWizardProvider");
  return v;
}
