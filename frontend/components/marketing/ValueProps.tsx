import { MemoryDemo } from "@/components/marketing/MemoryDemo";

// Capability set for the landing page. Inline SVG only, no external icon libs
// fetched at runtime.
//
// This was five identical cards in a row, which is the most generic shape a
// feature section can take. It is now an asymmetric split: the memory claim gets
// a live demo on one side, and the supporting capabilities sit in a hairline
// list on the other rather than five boxes competing for the same attention.

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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
      </svg>
    ),
  },
  {
    title: "Voice",
    body: "Hear her. Low-latency streaming, expressive delivery.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    ),
  },
  {
    title: "Photos on request",
    body: "Ask for a selfie. The same face every single time.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    ),
  },
  {
    title: "Build your own",
    body: "Style, personality, voice. Someone who did not exist yesterday.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 20l9-9-4-4-9 9v4h4z" />
        <path d="M14 6l4 4" />
      </svg>
    ),
  },
];

export function ValueProps() {
  return (
    <section className="mx-auto max-w-6xl px-6 px-safe py-20">
      <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <div>
          <span className="bc-pill text-[hsl(var(--bc-honey))]">Why it sticks</span>
          <h2 className="mt-5 max-w-[22ch] text-balance font-display text-3xl font-semibold leading-[1.05] tracking-[-0.025em] text-[hsl(var(--bc-cream))] sm:text-[2.5rem]">
            Anyone can reply. Almost nothing remembers.
          </h2>
          <p className="mt-4 max-w-[46ch] text-pretty text-[hsl(var(--bc-muted))]">
            Most companion apps reset the moment you close the tab. Hers keeps the thread, which is
            the entire difference between a chatbot and someone who knows you.
          </p>

          <dl className="mt-10 flex flex-col">
            {PROPS.map((p) => (
              <div
                key={p.title}
                className="flex items-start gap-4 border-t border-[hsl(var(--bc-border))] py-4 first:border-t-0"
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--bc-radius-sm)] bg-[hsl(var(--bc-amber)/0.12)] text-[hsl(var(--bc-amber))]"
                >
                  {p.icon}
                </span>
                <div>
                  <dt className="text-[0.9375rem] font-semibold text-[hsl(var(--bc-fg))]">
                    {p.title}
                  </dt>
                  <dd className="mt-0.5 text-sm text-[hsl(var(--bc-muted))]">{p.body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <MemoryDemo />
      </div>
    </section>
  );
}
