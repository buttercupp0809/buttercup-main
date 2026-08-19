import * as React from "react";

// Shared in-app page header used by the top-level protected pages (Chats,
// Discover, Settings, Billing). Mirrors the marketing hero treatment: a
// display-weight headline with an optional honey->amber gradient accent
// word, a muted sub-headline, and an optional actions slot on the right.
//
// The gradient stops pull from the brand tokens so tuning the palette flows
// through every hero and CTA without a second edit. Keep this component
// presentational only.

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  accent?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}

const GRADIENT_TEXT: React.CSSProperties = {
  background: "linear-gradient(90deg, hsl(var(--bc-honey)), hsl(var(--bc-amber)))",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

export function PageHeader({
  eyebrow,
  title,
  accent,
  description,
  actions,
  align = "left",
  className,
}: PageHeaderProps) {
  const centered = align === "center";
  return (
    <header
      className={[
        "mb-8 flex flex-col gap-4",
        centered ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between",
        className ?? "",
      ].join(" ")}
    >
      <div className={centered ? "flex flex-col items-center gap-2" : "flex min-w-0 flex-col gap-2"}>
        {eyebrow ? (
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
              style={{ background: "linear-gradient(90deg, hsl(var(--bc-honey)), hsl(var(--bc-amber)))" }}
              aria-hidden
            />
            {eyebrow}
          </span>
        ) : null}
        <h1 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          {title}
          {accent ? (
            <>
              {" "}
              <span style={GRADIENT_TEXT}>{accent}</span>
            </>
          ) : null}
        </h1>
        {description ? (
          <p
            className={[
              "text-pretty text-sm sm:text-base",
              centered ? "max-w-2xl" : "max-w-2xl",
            ].join(" ")}
            style={{ color: "hsl(var(--bc-muted))" }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
