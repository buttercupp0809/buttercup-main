// Social-proof band: a stat row + two short testimonials. All numbers and
// quotes are illustrative placeholders. Every one is annotated so we do not
// accidentally launch with invented figures.

interface Stat {
  value: string;
  label: string;
}

const STATS: Stat[] = [
  // PLACEHOLDER: replace with real metric before launch
  { value: "50k+", label: "Conversations started" },
  // PLACEHOLDER: replace with real metric before launch
  { value: "1.2M", label: "Messages exchanged" },
  // PLACEHOLDER: replace with real metric before launch
  { value: "4.8/5", label: "Average companion rating" },
];

interface Testimonial {
  quote: string;
  name: string;
  handle: string;
}

const TESTIMONIALS: Testimonial[] = [
  // PLACEHOLDER: replace with real testimonial before launch
  {
    quote: "It actually remembers what I told it last week. That is what sold me.",
    name: "Alex R.",
    handle: "@alex",
  },
  // PLACEHOLDER: replace with real testimonial before launch
  {
    quote: "The voice feels alive. I stopped using every other companion app after two days.",
    name: "Mira K.",
    handle: "@mira",
  },
];

export function SocialProof() {
  return (
    <section
      className="border-y py-16 backdrop-blur"
      style={{
        borderColor: "hsl(240 10% 18%)",
        background: "hsl(240 14% 9% / 0.6)",
      }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-3 gap-6 text-center">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div className="text-3xl font-semibold tracking-tight text-white">
                {s.value}
              </div>
              <div
                className="text-xs uppercase tracking-wide"
                style={{ color: "hsl(240 6% 65%)" }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.handle}
              className="buttercupp-glass rounded-2xl p-6"
            >
              <blockquote className="text-base text-white">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption
                className="mt-4 text-sm"
                style={{ color: "hsl(240 6% 65%)" }}
              >
                {t.name} <span className="opacity-60">{t.handle}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
