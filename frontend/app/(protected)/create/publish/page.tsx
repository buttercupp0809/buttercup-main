"use client";

import { useCharacterWizard } from "../context";
import { OptionCard, FieldGroup } from "../Chip";

export default function PublishStep() {
  const { draft, updateDraft } = useCharacterWizard();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Publish</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Last step. Choose who can see your companion.
        </p>
      </div>

      <FieldGroup title="Visibility">
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            label="Private"
            hint="Only you can chat with them"
            selected={draft.visibility === "private"}
            onClick={() => updateDraft({ visibility: "private" })}
          />
          <OptionCard
            label="Public"
            hint="Appears in Discover after moderation"
            selected={draft.visibility === "public"}
            onClick={() => updateDraft({ visibility: "public" })}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="Content rating">
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            label="SFW"
            hint="Safe for work"
            selected={draft.contentRating === "sfw"}
            onClick={() => updateDraft({ contentRating: "sfw" })}
          />
          <OptionCard
            label="Mature"
            hint="18+ only"
            selected={draft.contentRating === "mature"}
            onClick={() => updateDraft({ contentRating: "mature" })}
          />
        </div>
      </FieldGroup>

      <div
        className="rounded-md p-3 text-xs"
        style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))", color: "hsl(var(--buttercupp-muted))" }}
      >
        Clicking Finish saves your companion and drops you straight into a chat.
      </div>
    </div>
  );
}
