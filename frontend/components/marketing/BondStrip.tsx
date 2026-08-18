import { BOND_TIERS } from "@/lib/bond";

/*
 * The progression ladder, compressed to a single band.
 *
 * The tiers are the reason to come back tomorrow, so a visitor has to see that
 * they exist. But this is a companion product, not a dashboard: the mechanic
 * gets one horizontal strip that reads in three seconds, not a section with
 * body copy per tier. Fill increases left to right so the band itself shows the
 * climb.
 */

export function BondStrip() {
  const last = BOND_TIERS.length - 1;
  return (
    <section className="border-y border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface)/0.5)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 px-safe py-8 lg:flex-row lg:items-center lg:gap-10">
        <p className="shrink-0 font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--bc-cream))]">
          Every message moves her.
          <span className="ml-2 font-body text-sm font-normal text-[hsl(var(--bc-muted))]">
            Seven tiers, from stranger to hers.
          </span>
        </p>

        <ol className="-mx-6 flex items-center gap-1.5 overflow-x-auto px-6 pb-1 lg:mx-0 lg:flex-1 lg:justify-end lg:overflow-visible lg:px-0 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {BOND_TIERS.map((t, i) => (
            <li key={t.name} className="flex shrink-0 items-center gap-1.5">
              <span
                className="rounded-full border px-3 py-1.5 text-xs font-semibold tracking-tight"
                style={{
                  borderColor: `hsl(var(--bc-amber) / ${0.14 + (i / last) * 0.46})`,
                  backgroundColor: `hsl(var(--bc-amber) / ${0.04 + (i / last) * 0.14})`,
                  color:
                    i === last ? "hsl(var(--bc-amber))" : `hsl(var(--bc-cream) / ${0.6 + (i / last) * 0.35})`,
                }}
              >
                {t.name}
              </span>
              {i < last ? (
                <span aria-hidden className="h-px w-3 bg-[hsl(var(--bc-border-strong))]" />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
