import * as React from "react";
import { LEGAL } from "@/lib/legal/config";

// Presentational wrapper for every /legal/* page. Enforces the same visual
// treatment (hero header, "draft template" note, last-updated line, prose
// measure, sticky table of contents) so we never ship a page that forgets one.
// Everything sensitive is a placeholder token from LEGAL; nothing here is legal
// advice.

export interface LegalPageProps {
  title: string;
  children: React.ReactNode;
}

interface Section {
  id: string;
  label: string;
}

// Read the plain-text content of an arbitrary React children tree. Used to turn
// an <h2>1. Acceptance</h2> heading into "1. Acceptance" for the anchor label
// and slug. Copy is never modified, only read.
function textOf(node: React.ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

// Deterministic anchor slug from a heading's visible text. Collision-safe via
// the caller's running index so two headings never share an id.
function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return base || "section";
}

// Walk the top-level children, collect every <h2> into the table of contents,
// and clone each <h2> so it gains a stable id (the anchor target). Nothing else
// about the child is touched: text, links, and ARIA pass through untouched.
function collectSections(children: React.ReactNode): {
  sections: Section[];
  decorated: React.ReactNode;
} {
  const sections: Section[] = [];
  const used = new Set<string>();

  const decorated = React.Children.map(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "h2") return child;

    const label = textOf(child).trim();
    let id = slugify(label);
    let n = 2;
    while (used.has(id)) id = `${slugify(label)}-${n++}`;
    used.add(id);
    sections.push({ id, label });

    // Only inject an anchor id. Section spacing, the scroll-margin offset, and
    // the divider all come from the prose selector on the wrapper, so the copy
    // element keeps whatever className it arrived with.
    return React.cloneElement(child as React.ReactElement<{ id?: string }>, { id });
  });

  return { sections, decorated };
}

export function LegalPage({ title, children }: LegalPageProps) {
  const { sections, decorated } = collectSections(children);

  return (
    <div className="mx-auto max-w-6xl px-safe py-12 sm:py-16">
      {/* Header / hero block. Eyebrow kicker, display title, quiet metadata. */}
      <header className="bc-rise mx-auto max-w-3xl">
        <span
          className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{
            borderColor: "hsl(var(--bc-amber) / 0.35)",
            background:
              "linear-gradient(135deg, hsl(var(--bc-honey) / 0.12), hsl(var(--bc-amber) / 0.12))",
            color: "hsl(var(--bc-amber))",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: "linear-gradient(90deg, hsl(var(--bc-honey)), hsl(var(--bc-amber)))",
            }}
            aria-hidden
          />
          Legal
        </span>
        <h1 className="mt-4 font-display text-balance text-4xl font-semibold tracking-tight text-[hsl(var(--bc-fg))] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[hsl(var(--bc-subtle))]">
          <span
            className="h-1 w-1 rounded-full bg-[hsl(var(--bc-amber)/0.7)]"
            aria-hidden
          />
          Last updated: {LEGAL.LAST_UPDATED}
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
        {/* The document itself. */}
        <article
          data-testid="legal-page"
          className="min-w-0 text-[hsl(var(--bc-fg))]"
        >
          <div
            role="note"
            className="bc-rise flex gap-3 rounded-[var(--bc-radius)] border border-[hsl(var(--bc-amber)/0.35)] bg-[hsl(var(--bc-amber)/0.08)] px-4 py-3.5 text-sm text-[hsl(var(--bc-honey))] shadow-[var(--bc-shadow-sm)]"
          >
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--bc-amber)/0.2)] text-[hsl(var(--bc-amber))]"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </span>
            <span className="leading-6">
              <strong className="font-semibold text-[hsl(var(--bc-honey))]">
                Draft template pending legal review.
              </strong>{" "}
              This page is a placeholder for counsel. It is not legal advice and
              must not ship as-is.
            </span>
          </div>

          <div className="mt-9 max-w-[68ch] space-y-6 text-[0.9375rem] leading-7 text-[hsl(var(--bc-muted))] [&_h2]:mt-12 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-[hsl(var(--bc-border))] [&_h2]:pt-9 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:text-[hsl(var(--bc-fg))] [&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0 [&_h3]:mt-7 [&_h3]:font-display [&_h3]:text-xl [&_h3]:text-[hsl(var(--bc-fg))] [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ul]:marker:text-[hsl(var(--bc-amber)/0.6)] [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_ol]:marker:text-[hsl(var(--bc-subtle))] [&_p]:leading-7 [&_a]:font-medium [&_a]:text-[hsl(var(--bc-amber))] [&_a]:underline [&_a]:decoration-[hsl(var(--bc-amber)/0.5)] [&_a]:underline-offset-2 [&_a]:transition-colors hover:[&_a]:text-[hsl(var(--bc-honey))] hover:[&_a]:decoration-[hsl(var(--bc-honey)/0.7)] [&_strong]:font-semibold [&_strong]:text-[hsl(var(--bc-fg))]">
            {decorated}
          </div>
        </article>

        {/* Sticky table of contents. Desktop only; the document already reads
            top-to-bottom on mobile so a duplicate nav would only add noise. */}
        {sections.length > 1 ? (
          <aside className="hidden lg:block">
            <nav
              aria-label="On this page"
              className="sticky top-24 rounded-[var(--bc-radius-lg)] border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface)/0.5)] p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--bc-subtle))]">
                On this page
              </p>
              <ul className="mt-4 space-y-1 border-l border-[hsl(var(--bc-border))]">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm leading-snug text-[hsl(var(--bc-muted))] transition-colors hover:border-[hsl(var(--bc-amber))] hover:text-[hsl(var(--bc-amber))]"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
