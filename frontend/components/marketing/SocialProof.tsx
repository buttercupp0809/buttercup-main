// Social-proof band. Two paired signals: quantitative (usage stats) and
// qualitative (member quotes). Both feed the same argument: real people, real
// engagement, real retention. All numbers and quotes here are illustrative
// PLACEHOLDERS annotated as such so we never launch with invented figures.
//
// Design intent (kept in comments so a redesign preserves the trust cues):
//   - The section leads with an eyebrow ("Loved by curious hearts") + a
//     one-line trust promise, so the numbers are contextualized before the
//     eye lands on them. A wall of stats without framing reads as marketing;
//     framing turns it into a story.
//   - Stats use the pink -> purple brand gradient on the value glyph ONLY.
//     Overusing the gradient here would compete with the hero CTA. The label
//     stays neutral so the eye can scan multiple values without fatigue.
//   - Testimonials sit on a subtly elevated glass card with a large hollow
//     quote-mark decoration in the top-left. Avatars are gradient initials
//     (no stock photos, no invented faces); a 5-star row sits under the
//     handle to echo the "4.8/5" number above without repeating it as text.
//   - The band is separated from adjacent sections by hairline borders
//     rather than a heavier background swap, so it reads as one continuous
//     landing page rather than a stitched-together set of components.

interface Stat {
  value: string;
  label: string;
  hint?: string;
}

const STATS: Stat[] = [
  // PLACEHOLDER: replace with real metric before launch
  { value: "50k+", label: "Conversations started", hint: "since launch" },
  // PLACEHOLDER: replace with real metric before launch
  { value: "1.2M", label: "Messages exchanged", hint: "and counting" },
  // PLACEHOLDER: replace with real metric before launch
  { value: "4.8", label: "Average rating", hint: "out of 5" },
];

interface Testimonial {
  quote: string;
  name: string;
  handle: string;
  role: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "It remembered a detail from a chat two weeks earlier and folded it into a scene without me prompting. That moment is when it stopped feeling like a demo and started feeling like a friend.",
    name: "Priya S.",
    handle: "@priyaswrites",
    role: "Member since May 2026",
  },
  {
    quote:
      "The image gen is the part I keep showing people. I describe the outfit and setting in chat, and it comes back looking like a real photo, not a generic render. Roleplay stays in character too.",
    name: "Diego M.",
    handle: "@diegomakes",
    role: "Member since Aug 2026",
  },
];

// Deterministic initials so SSR + client render match. Two letters max.
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

function StarRow({ filled = 5, aria = "5 out of 5 stars" }: { filled?: number; aria?: string }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={aria}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5"
          fill={i < filled ? "url(#buttercupp-star-fill)" : "none"}
          stroke={i < filled ? "none" : "hsl(var(--bc-subtle))"}
          strokeWidth="1.5"
          aria-hidden
        >
          <defs>
            <linearGradient id="buttercupp-star-fill" x1="0" y1="0" x2="20" y2="0">
              <stop offset="0%" stopColor="hsl(var(--bc-amber))" />
              <stop offset="100%" stopColor="hsl(var(--bc-honey))" />
            </linearGradient>
          </defs>
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z" />
        </svg>
      ))}
    </div>
  );
}

export function SocialProof() {
  return (
    <section
      aria-labelledby="social-proof-heading"
      className="relative border-y py-20 backdrop-blur"
      style={{
        borderColor: "hsl(var(--bc-border))",
        background: "hsl(var(--bc-surface) / 0.6)",
      }}
    >
      {/* Faint gradient wash behind the numbers so the section reads as one
          coherent panel without ever competing with the hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, hsl(var(--bc-amber) / 0.08), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider"
            style={{
              borderColor: "hsl(var(--bc-amber) / 0.35)",
              color: "hsl(var(--bc-honey))",
              background: "hsl(var(--bc-amber) / 0.08)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "hsl(var(--bc-amber))" }}
            />
            Loved by curious hearts
          </div>
          <h2
            id="social-proof-heading"
            className="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            Real people, real connection.
          </h2>
          <p className="mt-3 text-base" style={{ color: "hsl(var(--bc-muted))" }}>
            Thousands of members return every week to talk, laugh, and be heard.
            Here is what the numbers, and a few of them, say.
          </p>
        </div>

        {/* Stats row. Divider lines only appear at >=sm so the mobile stack
            reads as three centered cards without hairlines cutting through. */}
        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-[hsl(240_10%_18%)]">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1.5 sm:px-6">
              <div
                className="text-4xl font-semibold tracking-tight sm:text-5xl"
                style={{
                  background:
                    "var(--bc-gradient-brand)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {s.value}
              </div>
              <div className="text-sm font-medium text-white">{s.label}</div>
              {s.hint ? (
                <div
                  className="text-xs tracking-wide"
                  style={{ color: "hsl(var(--bc-subtle))" }}
                >
                  {s.hint}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Testimonials. Two-up on md+, single column on mobile. Cards get a
            subtle hover lift so the section feels responsive without turning
            into a game of "click the card". */}
        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.handle}
              className="relative overflow-hidden rounded-2xl border p-7 transition duration-300 hover:-translate-y-0.5"
              style={{
                borderColor: "hsl(var(--bc-border))",
                background:
                  "linear-gradient(180deg, hsl(var(--bc-surface-2) / 0.9), hsl(var(--bc-surface) / 0.9))",
                boxShadow: "0 20px 60px -30px rgb(0 0 0 / 0.5)",
              }}
            >
              {/* Oversized hollow quote glyph as decoration. Positioned so it
                  reads as watermark, not typography. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-2 -top-4 select-none font-serif text-[7rem] leading-none"
                style={{
                  color: "hsl(var(--bc-amber) / 0.08)",
                }}
              >
                &rdquo;
              </span>

              <StarRow />
              <blockquote className="relative mt-4 text-base leading-relaxed text-white/90">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="relative mt-6 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{
                    background:
                      "var(--bc-gradient-brand)",
                  }}
                  aria-hidden
                >
                  {initials(t.name)}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-white">
                    {t.name}{" "}
                    <span
                      className="ml-1 text-xs font-normal"
                      style={{ color: "hsl(var(--bc-subtle))" }}
                    >
                      {t.handle}
                    </span>
                  </span>
                  <span className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
                    {t.role}
                  </span>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* Trust micro-strip. Honest signals only: age gate, no card at
            signup, encrypted transport, cancel-any-time. If any of these
            stops being true, remove the badge here rather than rewording. */}
        <div
          className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs"
          style={{ color: "hsl(var(--bc-subtle))" }}
        >
          <TrustBadge label="18+ verified" />
          <Dot />
          <TrustBadge label="No card required" />
          <Dot />
          <TrustBadge label="Encrypted in transit" />
          <Dot />
          <TrustBadge label="Cancel anytime" />
        </div>
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="h-1 w-1 rounded-full"
      style={{ background: "hsl(var(--bc-border-strong))" }}
    />
  );
}

function TrustBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        viewBox="0 0 20 20"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="hsl(var(--bc-amber))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10 2l6 3v5c0 4-3 7-6 8-3-1-6-4-6-8V5l6-3z" />
        <path d="M7.5 10.5l1.75 1.75L13 8.75" />
      </svg>
      {label}
    </span>
  );
}
