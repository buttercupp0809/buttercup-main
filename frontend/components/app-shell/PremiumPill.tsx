import Link from "next/link";

// Gradient-outline "Premium 70% OFF" pill that lives in the top-right of the
// in-app header and links to billing. The gradient shows only as a border: an
// outer gradient layer with a 1.5px pad wraps an inner pill filled with the
// header background.
export function PremiumPill({ label = "70% OFF" }: { label?: string }) {
  return (
    <Link
      href="/billing"
      aria-label={`Premium, ${label}`}
      className="rounded-full p-[1.5px] transition hover:opacity-90"
      style={{
        background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
      }}
    >
      <span
        className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold"
        style={{ backgroundColor: "hsl(var(--buttercupp-bg))", color: "hsl(var(--buttercupp-fg))" }}
      >
        Premium
        <span style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>{label}</span>
      </span>
    </Link>
  );
}
