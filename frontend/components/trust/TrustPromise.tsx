import Link from "next/link";
import { TRUST_HEADLINE, TRUST_PROMISES } from "./copy";

// Marketing-grade trust block. Playful, image-forward (emoji tiles inside
// gradient wells), reuses the site's rose + violet accent so it feels part
// of the product rather than a bolted-on compliance banner.
//
// Used by:
// - frontend/app/(public)/page.tsx (between ValueProps and SocialProof).
// - frontend/app/onboarding/identity/page.tsx (compact variant).
//
// Variants:
// - "full" (default): four large cards + headline + CTA link to the deep
//   /legal/privacy-promise page. Meant for the marketing home.
// - "compact": same cards at smaller scale, no headline, no CTA. Meant to
//   drop into narrower shells like the onboarding modal.

export interface TrustPromiseProps {
  variant?: "full" | "compact";
}

export function TrustPromise({ variant = "full" }: TrustPromiseProps) {
  const isCompact = variant === "compact";
  return (
    <section
      aria-labelledby="trust-promise-heading"
      className={
        isCompact
          ? "w-full"
          : "mx-auto max-w-6xl px-6 py-20"
      }
    >
      {!isCompact ? (
        <div className="mb-10 text-center">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: "hsl(var(--buttercupp-accent-rose) / 0.4)",
              color: "hsl(var(--buttercupp-accent-rose))",
              background: "hsl(var(--buttercupp-accent-rose) / 0.08)",
            }}
          >
            <LockGlyph className="h-3 w-3" />
            Privacy promise
          </span>
          <h2
            id="trust-promise-heading"
            className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            {splitHeadline(TRUST_HEADLINE)}
          </h2>
          <p
            className="mx-auto mt-3 max-w-2xl text-pretty"
            style={{ color: "hsl(var(--bc-muted))" }}
          >
            No jargon, no fine print. Four promises we keep, one page you can
            read in a minute.
          </p>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2">
          <LockGlyph className="h-4 w-4" style={{ color: "hsl(var(--buttercupp-accent-rose))" }} />
          <span className="text-sm font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
            Before we start, a quick promise.
          </span>
        </div>
      )}

      <div
        className={
          isCompact
            ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
            : "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
        {TRUST_PROMISES.map((p) => (
          <div
            key={p.id}
            className={
              isCompact
                ? "buttercupp-glass flex items-start gap-3 rounded-xl p-3"
                : "buttercupp-glass group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl p-6 transition hover:-translate-y-0.5"
            }
          >
            {!isCompact ? (
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-70 blur-2xl transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle, hsl(var(--buttercupp-accent-rose) / 0.35), transparent 70%)",
                }}
              />
            ) : null}
            <div
              className={
                isCompact
                  ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
                  : "flex h-11 w-11 items-center justify-center rounded-xl text-xl"
              }
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.18), hsl(var(--buttercupp-accent-violet) / 0.18))",
                border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.25)",
              }}
              aria-hidden
            >
              {p.emoji}
            </div>
            <div className="flex flex-col gap-1">
              <h3
                className={
                  isCompact
                    ? "font-display text-sm font-semibold text-white"
                    : "font-display text-base font-semibold text-white"
                }
              >
                {p.title}
              </h3>
              <p
                className={isCompact ? "text-xs leading-relaxed" : "text-sm leading-relaxed"}
                style={{ color: "hsl(var(--bc-muted))" }}
              >
                {p.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {!isCompact ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/legal/privacy-promise"
            className="rounded-full border px-4 py-2 font-medium transition hover:opacity-80"
            style={{
              borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
              color: "hsl(var(--buttercupp-accent-rose))",
              background: "transparent",
            }}
          >
            Read the full privacy promise
          </Link>
          <span style={{ color: "hsl(var(--bc-subtle))" }}>
            Curious about the details? We spell them out.
          </span>
        </div>
      ) : null}
    </section>
  );
}

// Splits the headline so the last two words get the rose to violet gradient
// treatment the rest of the marketing page uses.
function splitHeadline(text: string) {
  const parts = text.trim().replace(/\.$/, "").split(" ");
  if (parts.length < 3) return <>{text}</>;
  const tail = parts.slice(-2).join(" ");
  const head = parts.slice(0, -2).join(" ");
  return (
    <>
      {head}{" "}
      <span
        style={{
          background:
            "var(--bc-gradient-brand-h)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        {tail}
      </span>
      .
    </>
  );
}

function LockGlyph({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
