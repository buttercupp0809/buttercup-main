"use client";

import { useCharacterWizard } from "../context";

const OPTIONS: {
  key: "realistic" | "3d" | "anime";
  label: string;
  tagline: string;
  bullets: string[];
  gradient: string;
  accentColor: string;
}[] = [
    {
      key: "realistic",
      label: "Hyper-realistic",
      tagline: "Cinematic photography",
      bullets: ["8K photorealism", "Cinematic lighting", "Natural skin tones", "DSLR depth of field"],
      gradient: "linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)",
      accentColor: "#e8b4b8",
    },
    {
      key: "3d",
      label: "Stylized 3D",
      tagline: "Polished render art",
      bullets: ["3D character model", "Expressive features", "Soft subsurface glow", "Dynamic poses"],
      gradient: "linear-gradient(135deg, #0d1b2a 0%, #1b2838 40%, #2d3561 100%)",
      accentColor: "#b4c8e8",
    },
    {
      key: "anime",
      label: "Anime",
      tagline: "Illustrated & vibrant",
      bullets: ["Hand-drawn aesthetic", "Bold outlines", "Vivid color palette", "Expressive eyes"],
      gradient: "linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 40%, #4a1a6e 100%)",
      accentColor: "#e8a0ef",
    },
  ];

// Decorative inner pattern per style
function StyleVisual({ styleKey }: { styleKey: "realistic" | "3d" | "anime" }) {
  if (styleKey === "realistic") {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 60% 40%, rgba(232,180,184,0.5) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(255,255,255,0.1) 0%, transparent 40%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-1">
          <div
            className="h-16 w-12 rounded-full opacity-70"
            style={{
              background: "linear-gradient(180deg, #f0c8c0 0%, #d4a0a0 50%, #b08080 100%)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          />
          <div
            className="h-1 w-8 rounded-full opacity-30"
            style={{ background: "rgba(232,180,184,0.6)", filter: "blur(4px)" }}
          />
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 h-16 opacity-30"
          style={{
            background: "linear-gradient(0deg, rgba(232,180,184,0.3) 0%, transparent 100%)",
          }}
        />
      </div>
    );
  }

  if (styleKey === "3d") {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 30%, rgba(180,200,232,0.5) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-1">
          <div
            className="h-14 w-10 rounded-full opacity-80"
            style={{
              background:
                "linear-gradient(135deg, #c8d8f0 0%, #8ab4e0 40%, #4a80c8 80%, #2060a8 100%)",
              boxShadow: "0 0 30px rgba(100,160,240,0.4), 0 8px 24px rgba(0,0,0,0.4)",
            }}
          />
          <div className="flex gap-1 opacity-50">
            {[3, 5, 3].map((h, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  width: "6px",
                  height: `${h * 4}px`,
                  background: "rgba(180,200,232,0.6)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(232,160,239,0.6) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-1">
        <div
          className="h-14 w-10 rounded-full opacity-90"
          style={{
            background: "linear-gradient(180deg, #f8c8ff 0%, #d080f0 50%, #a040c8 100%)",
            boxShadow: "0 0 24px rgba(200,100,255,0.5), 0 8px 20px rgba(0,0,0,0.4)",
          }}
        />
        {/* Anime sparkle dots */}
        {[["-14px", "-10px"], ["16px", "-6px"], ["-8px", "16px"]].map(([l, t], i) => (
          <div
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              left: `calc(50% + ${l})`,
              top: `calc(50% + ${t})`,
              background: "#f0c0ff",
              boxShadow: "0 0 6px rgba(240,100,255,0.8)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function StyleStep() {
  const { draft, updateDraft } = useCharacterWizard();
  const current = draft.style;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Choose your style</h1>
        <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          This sets the visual language for every image your companion generates.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const selected = current === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => updateDraft({ style: o.key })}
              className="group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-200"
              style={{
                background: o.gradient,
                border: selected
                  ? `2px solid hsl(var(--buttercupp-accent-rose))`
                  : "2px solid rgba(255,255,255,0.08)",
                boxShadow: selected
                  ? `0 0 0 1px hsl(var(--buttercupp-accent-rose) / 0.3), 0 8px 32px rgba(0,0,0,0.4)`
                  : "0 4px 16px rgba(0,0,0,0.3)",
                transform: selected ? "translateY(-2px)" : undefined,
              }}
            >
              {/* Visual preview area */}
              <div className="relative h-36 w-full">
                <StyleVisual styleKey={o.key} />

                {/* Selection badge */}
                {selected && (
                  <div
                    className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                      color: "#ffffff",
                    }}
                  >
                    ✓
                  </div>
                )}
              </div>

              {/* Text content */}
              <div className="flex flex-col gap-2 p-4">
                <div>
                  <p
                    className="font-display text-base font-semibold"
                    style={{ color: selected ? o.accentColor : "rgba(255,255,255,0.9)" }}
                  >
                    {o.label}
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {o.tagline}
                  </p>
                </div>

                <ul className="flex flex-col gap-1">
                  {o.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-center gap-1.5 text-xs"
                      style={{ color: "rgba(255,255,255,0.6)" }}
                    >
                      <span
                        className="h-1 w-1 shrink-0 rounded-full"
                        style={{ background: o.accentColor, opacity: 0.7 }}
                      />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Bottom glow when selected */}
              {selected && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{
                    background:
                      "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {current && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface-2))",
            borderLeft: `3px solid hsl(var(--buttercupp-accent-rose))`,
            color: "hsl(var(--buttercupp-muted))",
          }}
        >
          <span style={{ color: "hsl(var(--buttercupp-fg))", fontWeight: 500 }}>
            {OPTIONS.find((o) => o.key === current)?.label}
          </span>{" "}
          selected. Your companion's images will use this visual style.
        </div>
      )}
    </div>
  );
}
