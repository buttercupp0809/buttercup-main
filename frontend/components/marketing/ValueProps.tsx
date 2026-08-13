// Five value props for the landing page. Inline SVG only, no external icon
// libs fetched at runtime.

interface Prop {
  title: string;
  body: string;
  icon: React.ReactNode;
}

const PROPS: Prop[] = [
  {
    title: "Unfiltered chat",
    body: "Real conversation, no lectures. Mature-friendly when you want it.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
      </svg>
    ),
  },
  {
    title: "Voice",
    body: "Hear your companion. Low-latency streaming, expressive delivery.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    ),
  },
  {
    title: "Image",
    body: "Ask for a selfie. Consistent looks across every generation.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    ),
  },
  {
    title: "Memory",
    body: "They remember what matters. Facts, moods, and inside jokes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 2-5 3 3 0 0 0-2-5V7a4 4 0 0 0-4-4z" />
      </svg>
    ),
  },
  {
    title: "Create your own",
    body: "Style, personality, voice. A companion built exactly to your taste.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 20l9-9-4-4-9 9v4h4z" />
        <path d="M14 6l4 4" />
      </svg>
    ),
  },
];

export function ValueProps() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-white">
          Everything you need for{" "}
          <span
            style={{
              background: "linear-gradient(90deg, hsl(344 84% 71%), hsl(262 72% 68%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            real connection
          </span>
        </h2>
        <p
          className="mx-auto mt-2 max-w-2xl"
          style={{ color: "hsl(240 6% 65%)" }}
        >
          Five things that make ButterCupp feel less like a chatbot and more like a person you know.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {PROPS.map((p) => (
          <div
            key={p.title}
            className="buttercupp-glass flex flex-col items-start gap-3 rounded-2xl p-5 transition hover:-translate-y-0.5"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: "hsl(344 84% 71% / 0.12)",
                color: "hsl(344 84% 71%)",
              }}
            >
              {p.icon}
            </div>
            <h3 className="text-base font-semibold text-white">{p.title}</h3>
            <p className="text-sm" style={{ color: "hsl(240 6% 65%)" }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
