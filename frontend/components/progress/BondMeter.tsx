import { BOND_TIERS, type BondProgress } from "@/lib/bond";
import { cn } from "@/lib/utils";

// The bond meter. Server-safe: no state, no effects, no client bundle.
//
// The track is SEGMENTED, one segment per tier, rather than a single bar. A
// plain 0-100 bar tells you how far along you are but not where you are going;
// seven segments make the whole arc of the relationship visible at a glance, so
// the next milestone is always legible and the filled segments behind you read
// as earned ground. The current segment fills partially, which is what gives
// the meter something to move every session.

export function BondMeter({
  bond,
  memoryCount,
  size = "md",
  className,
}: {
  bond: BondProgress;
  /** Shown as the receipt for the tier: the thing the user can verify. */
  memoryCount?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "font-display font-semibold tracking-tight text-[hsl(var(--bc-honey))]",
            sm ? "text-sm" : "text-lg",
          )}
        >
          {bond.tier.name}
        </span>
        <span
          className={cn(
            "tabular text-[hsl(var(--bc-subtle))]",
            sm ? "text-[0.6875rem]" : "text-xs",
          )}
        >
          {bond.isMax ? "Bond complete" : `${bond.toNext} to ${bond.nextTier?.name}`}
        </span>
      </div>

      <div
        className={cn("mt-2 flex w-full items-center", sm ? "gap-1" : "gap-1.5")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={BOND_TIERS.length}
        aria-valuenow={bond.tier.index + bond.fraction}
        aria-valuetext={`${bond.tier.name}, ${bond.isMax ? "complete" : `${bond.toNext} points to ${bond.nextTier?.name}`}`}
      >
        {BOND_TIERS.map((t) => {
          const passed = t.index < bond.tier.index;
          const active = t.index === bond.tier.index;
          const fill = passed ? 1 : active ? Math.max(bond.isMax ? 1 : 0.06, bond.fraction) : 0;
          return (
            <span
              key={t.name}
              className={cn(
                "relative flex-1 overflow-hidden rounded-full",
                sm ? "h-1" : "h-1.5",
              )}
              style={{ backgroundColor: "hsl(var(--bc-surface-3))" }}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${fill * 100}%`,
                  // Passed segments sit in flat amber; the live one carries the
                  // honey-to-amber sweep so the eye lands on where you are now.
                  background: active ? "var(--bc-gradient-brand-h)" : "hsl(var(--bc-amber))",
                  transition: "width var(--dur-slow) var(--ease-out)",
                }}
              />
              {active && !bond.isMax ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-1/3 motion-reduce:hidden"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, hsl(var(--bc-cream) / 0.45), transparent)",
                    animation: "bc-sweep 2.6s var(--ease-in-out) infinite",
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>

      <p
        className={cn(
          "mt-2 text-pretty text-[hsl(var(--bc-muted))]",
          sm ? "text-[0.6875rem] leading-snug" : "text-[0.8125rem] leading-relaxed",
        )}
      >
        {bond.tier.blurb}
      </p>

      {typeof memoryCount === "number" && memoryCount > 0 ? (
        <p className={cn("mt-1 text-[hsl(var(--bc-subtle))]", sm ? "text-[0.625rem]" : "text-xs")}>
          <span className="tabular text-[hsl(var(--bc-honey))]">{memoryCount}</span>{" "}
          {memoryCount === 1 ? "thing" : "things"} she remembers about you
        </p>
      ) : null}
    </div>
  );
}

// Compact inline form for list rows and chat headers, where the full meter would
// dominate. Shows the tier name and a single filled bar for the current tier.
export function BondPill({ bond, className }: { bond: BondProgress; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        className,
      )}
      style={{
        borderColor: "hsl(var(--bc-amber) / 0.28)",
        backgroundColor: "hsl(var(--bc-amber) / 0.08)",
      }}
      title={`${bond.tier.name} - ${bond.tier.blurb}`}
    >
      <span className="text-[0.6875rem] font-semibold tracking-tight text-[hsl(var(--bc-honey))]">
        {bond.tier.name}
      </span>
      <span
        className="relative h-1 w-10 overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--bc-surface-3))" }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(bond.isMax ? 100 : 6, bond.fraction * 100)}%`,
            background: "var(--bc-gradient-brand-h)",
          }}
        />
      </span>
    </span>
  );
}
