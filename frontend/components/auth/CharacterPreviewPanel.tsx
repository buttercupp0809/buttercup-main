export interface PreviewChar {
  name: string;
  avatarUrl: string;
}

interface Props {
  chars: PreviewChar[];
  tagline: string;
  subtitle: string;
}

export function CharacterPreviewPanel({ chars, tagline, subtitle }: Props) {
  // Split into two columns: left starts lower, right starts higher, creating
  // a natural stagger that fills vertical space without overlapping.
  const col1 = chars.filter((_, i) => i % 2 === 0);
  const col2 = chars.filter((_, i) => i % 2 === 1);

  return (
    <div
      className="hidden md:flex md:w-1/2 relative overflow-hidden flex-col"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 20% 10%, hsl(var(--bc-amber) / 0.22) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 80% 80%, hsl(var(--bc-honey) / 0.14) 0%, transparent 55%),
          hsl(var(--bc-bg))
        `,
      }}
      aria-hidden="true"
    >
      {chars.length > 0 ? (
        <>
          {/* Two-column portrait grid, staggered vertically */}
          <div className="absolute inset-0 flex gap-3 p-4 overflow-hidden">
            {/* Left column: starts at the top */}
            <div className="flex flex-1 flex-col gap-3">
              {col1.map((char) => (
                <PortraitCard key={char.name} char={char} />
              ))}
            </div>
            {/* Right column: shifted down to stagger the layout */}
            <div className="flex flex-1 flex-col gap-3 mt-12">
              {col2.map((char) => (
                <PortraitCard key={char.name} char={char} />
              ))}
            </div>
          </div>

          {/* Vignette: fade top and bottom into the background */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `
                linear-gradient(to bottom,
                  hsl(var(--bc-bg)) 0%,
                  transparent 18%,
                  transparent 55%,
                  hsl(var(--bc-bg) / 0.7) 75%,
                  hsl(var(--bc-bg)) 100%
                )
              `,
              zIndex: 2,
            }}
          />
        </>
      ) : (
        /* Fallback: ambient glow blobs when no chars available */
        <>
          <div
            className="absolute rounded-full"
            style={{ width: "18rem", height: "18rem", top: "10%", left: "5%", background: "hsl(var(--bc-amber) / 0.12)", filter: "blur(60px)" }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: "14rem", height: "14rem", bottom: "20%", right: "5%", background: "hsl(var(--bc-honey) / 0.12)", filter: "blur(50px)" }}
          />
        </>
      )}

      {/* Wordmark */}
      <div className="absolute top-7 left-8 z-10">
        <a
          href="/"
          className="font-display text-base tracking-tight cursor-pointer"
          style={{
            background: "var(--bc-gradient-brand)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          ButterCupp
        </a>
      </div>

      {/* Tagline anchored at the bottom */}
      <div className="absolute bottom-12 left-9 right-9" style={{ zIndex: 3 }}>
        <p
          className="font-display leading-tight"
          style={{
            fontSize: "clamp(2rem, 3.5vw, 3.25rem)",
            fontStyle: "italic",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            background: "linear-gradient(135deg, hsl(var(--bc-cream) / 0.96) 0%, hsl(var(--bc-honey) / 0.88) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textWrap: "balance",
          } as React.CSSProperties}
        >
          {tagline}
        </p>
        <p className="mt-2 text-sm" style={{ color: "hsl(var(--bc-muted) / 0.9)" }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function PortraitCard({ char }: { char: PreviewChar }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        aspectRatio: "3 / 4",
        flexShrink: 0,
        boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <img
        src={char.avatarUrl}
        alt={char.name}
        className="h-full w-full object-cover object-top"
      />
      {/* Name badge at bottom */}
      <div
        className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-8"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)" }}
      >
        <p className="truncate text-xs font-semibold text-white/90 tracking-wide drop-shadow">
          {char.name}
        </p>
      </div>
    </div>
  );
}
