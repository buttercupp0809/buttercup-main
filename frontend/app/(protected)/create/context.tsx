"use client";

// Wizard state provider. Holds the draft in React state + mirrors it to
// localStorage so a reload preserves work. Hydrates from storage on mount;
// renders children only once hydrated so the server-rendered shell does not
// flicker back to defaults.
//
// Phase 28: also supports EDIT mode. Entering /create/style?editCharacterId=
// <id> seeds the draft from GET /api/characters/:id (owner-only editDraft)
// instead of the create-draft localStorage key, and submit() PATCHes
// instead of POSTing. The two modes use distinct localStorage keys so an
// in-progress create draft is never clobbered by an in-progress edit (or
// vice versa).

import * as React from "react";
import {
  CHARACTER_DRAFT_STORAGE_KEY,
  CHARACTER_EDIT_DRAFT_STORAGE_KEY,
  type CharacterDraft,
  type CreateCharacterInput,
  type PatchCharacterInput,
  type CharacterDetailDTO,
} from "@buttercupp/shared";
import { CHARACTER_STEPS, getStep, validateStep, type StepKey } from "./steps";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { appearanceChanged } from "@/lib/character-appearance";

export type WizardMode = "create" | "edit";

interface WizardContextValue {
  draft: CharacterDraft;
  hydrated: boolean;
  mode: WizardMode;
  characterId: string | null;
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

interface StoredEditDraft {
  characterId: string;
  draft: CharacterDraft;
}

export function CharacterWizardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = React.useState<CharacterDraft>({});
  const [mode, setMode] = React.useState<WizardMode>("create");
  const [characterId, setCharacterId] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Snapshot of the draft the edit wizard was seeded with, so submit() can
  // tell whether appearance-affecting fields changed. Null in create mode.
  const originalDraftRef = React.useRef<CharacterDraft | null>(null);

  React.useEffect(() => {
    const editId = searchParams?.get("editCharacterId") ?? null;

    async function hydrateEdit(id: string) {
      try {
        const res = await fetch(`/api/characters/${id}`);
        if (res.ok) {
          const body = (await res.json()) as CharacterDetailDTO;
          if (body.isOwner && body.editDraft) {
            setDraft(body.editDraft);
            originalDraftRef.current = body.editDraft;
            setMode("edit");
            setCharacterId(id);
            try {
              const stored: StoredEditDraft = { characterId: id, draft: body.editDraft };
              window.localStorage.setItem(CHARACTER_EDIT_DRAFT_STORAGE_KEY, JSON.stringify(stored));
            } catch {
              // storage disabled/quota exceeded
            }
            setHydrated(true);
            return;
          }
        }
      } catch {
        // fall through to create-mode hydration below
      }
      // Owner check failed, character missing, or the fetch itself failed:
      // do not silently edit someone else's character. Fall back to a fresh
      // create draft instead of leaving the wizard stuck unhydrated.
      setMode("create");
      setCharacterId(null);
      setHydrated(true);
    }

    if (editId) {
      void hydrateEdit(editId);
      return;
    }

    try {
      const raw = window.localStorage.getItem(CHARACTER_DRAFT_STORAGE_KEY);
      if (raw) setDraft(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
    setMode("create");
    setCharacterId(null);
    setHydrated(true);
    // Only re-run if the edit target changes; step-to-step navigation within
    // /create/* must not re-trigger a hydration fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.get("editCharacterId")]);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      if (mode === "edit" && characterId) {
        const stored: StoredEditDraft = { characterId, draft: sanitizeForStorage(draft) };
        window.localStorage.setItem(CHARACTER_EDIT_DRAFT_STORAGE_KEY, JSON.stringify(stored));
      } else {
        window.localStorage.setItem(
          CHARACTER_DRAFT_STORAGE_KEY,
          JSON.stringify(sanitizeForStorage(draft)),
        );
      }
    } catch {
      // storage disabled/quota exceeded
    }
  }, [draft, hydrated, mode, characterId]);

  const currentStepKey = stepKeyFromPath(pathname ?? "");
  const step = getStep(currentStepKey);
  const validation = validateStep(step, draft);

  const updateDraft = React.useCallback((patch: CharacterDraft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  // The hydration effect above keys off ?editCharacterId= to decide whether
  // to seed the edit draft or a fresh create draft; if step-to-step
  // navigation dropped that param, the effect would see it disappear and
  // silently fall back to create mode mid-edit. So every push within the
  // wizard must carry the param forward for as long as we are editing.
  const withEditParam = React.useCallback(
    (path: string) => (mode === "edit" && characterId ? `${path}?editCharacterId=${characterId}` : path),
    [mode, characterId],
  );

  const goNext = React.useCallback(() => {
    if (!validation.ok) return;
    const idx = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
    const next = CHARACTER_STEPS[idx + 1];
    if (next) router.push(withEditParam(next.path));
  }, [validation.ok, currentStepKey, router, withEditParam]);

  const goBack = React.useCallback(() => {
    const idx = CHARACTER_STEPS.findIndex((s) => s.key === currentStepKey);
    const prev = CHARACTER_STEPS[idx - 1];
    if (prev) router.push(withEditParam(prev.path));
  }, [currentStepKey, router, withEditParam]);

  const clearEditStorage = React.useCallback(() => {
    try {
      window.localStorage.removeItem(CHARACTER_EDIT_DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const submit = React.useCallback(async (): Promise<
    { ok: true; id: string } | { ok: false; error: string }
  > => {
    setSaving(true);
    try {
      if (mode === "edit" && characterId) {
        const changedAppearance = appearanceChanged(originalDraftRef.current, draft);
        const res = await fetch(`/api/characters/${characterId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft as PatchCharacterInput),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `http_${res.status}` };
        }
        // Only re-run creation-image generation when appearance-affecting
        // fields actually changed; a personality/name-only edit should not
        // burn a fresh set of images. Non-blocking either way.
        if (changedAppearance) {
          fetch(`/api/characters/${characterId}/generate-images`, { method: "POST" }).catch(() => null);
        }
        clearEditStorage();
        setDraft({});
        return { ok: true, id: characterId };
      }

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
      // Fire image generation in the background. Non-blocking: the queue or
      // Redis may be offline and the pipeline fails gracefully in that case.
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
  }, [draft, mode, characterId, clearEditStorage]);

  const reset = React.useCallback(() => {
    setDraft({});
    setMode("create");
    setCharacterId(null);
    originalDraftRef.current = null;
    try {
      window.localStorage.removeItem(CHARACTER_DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    clearEditStorage();
  }, [clearEditStorage]);

  const value: WizardContextValue = {
    draft,
    hydrated,
    mode,
    characterId,
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
