import Link from "next/link";

// Tiny inline "this is a private space" chip. Two sizes:
//
// - "sm" is intended to live inside a chat header or a card header where
//   real estate is scarce. It shows the lock glyph and a short label.
// - "md" is intended to live inside a settings panel or an in-app banner
//   where we can afford a slightly larger and more legible chip.
//
// The whole chip is a link to the privacy-promise deep page so a curious
// user can read what the lock actually means. This is the only place we
// call it a "private chat" chip and it should never be used as a
// standalone claim without the deep page as its backing detail.

export interface LockedBadgeProps {
  size?: "sm" | "md";
  label?: string;
}

export function LockedBadge({ size = "sm", label = "Private chat" }: LockedBadgeProps) {
  const isSm = size === "sm";
  return (
    <Link
      href="/legal/privacy-promise"
      title="Locked and private. Tap to learn what this means."
      className={
        isSm
          ? "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80"
          : "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-80"
      }
      style={{
        borderColor: "hsl(var(--buttercupp-accent-rose) / 0.4)",
        color: "hsl(var(--buttercupp-accent-rose))",
        background: "hsl(var(--buttercupp-accent-rose) / 0.08)",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isSm ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}
        aria-hidden
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      {label}
    </Link>
  );
}
