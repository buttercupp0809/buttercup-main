import Link from "next/link";
import { TRUST_CHIPS } from "./copy";

// Compact horizontal strip of trust chips. Sits under auth CTAs so the
// last thing a user sees before typing an email or password is a small
// visual promise that their data is treated with care.
//
// Kept intentionally small and un-clickable per-chip (single Link on the
// row) so it never competes with the form for attention. The whole row
// deep-links to the privacy-promise page for anyone who wants details.
//
// Used by:
// - frontend/app/login/LoginForm.tsx
// - frontend/app/signup/SignupForm.tsx

export interface TrustStripProps {
  align?: "start" | "center";
  href?: string;
}

export function TrustStrip({ align = "center", href = "/legal/privacy-promise" }: TrustStripProps) {
  return (
    <div
      className={
        align === "center"
          ? "mt-4 flex flex-col items-center gap-2"
          : "mt-4 flex flex-col items-start gap-2"
      }
    >
      <div
        role="list"
        aria-label="Privacy promises"
        className="flex flex-wrap items-center justify-center gap-1.5"
      >
        {TRUST_CHIPS.map((c) => (
          <span
            key={c.id}
            role="listitem"
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium"
            style={{
              borderColor: "hsl(var(--buttercupp-border))",
              background: "hsl(var(--buttercupp-surface-2) / 0.6)",
              color: "hsl(var(--buttercupp-fg))",
            }}
          >
            <Dot />
            {c.label}
          </span>
        ))}
      </div>
      <Link
        href={href}
        className="text-[11px] underline underline-offset-2 transition hover:opacity-80"
        style={{ color: "hsl(var(--buttercupp-muted))" }}
      >
        Read our privacy promise
      </Link>
    </div>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 rounded-full"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
      }}
    />
  );
}
