"use client";

import { useCharacterWizard } from "../context";
import { OptionCard } from "../Chip";

const OPTIONS: { key: "realistic" | "3d" | "anime"; label: string; hint: string }[] = [
  { key: "realistic", label: "Hyper-realistic", hint: "photoreal, cinematic" },
  { key: "3d", label: "Stylized 3D", hint: "polished, expressive" },
  { key: "anime", label: "Anime", hint: "illustrated, vibrant" },
];

export default function StyleStep() {
  const { draft, updateDraft } = useCharacterWizard();
  const current = draft.style;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Pick a style</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          This sets the base look and how images are generated.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <OptionCard
            key={o.key}
            label={o.label}
            hint={o.hint}
            selected={current === o.key}
            onClick={() => updateDraft({ style: o.key })}
          />
        ))}
      </div>
    </div>
  );
}
