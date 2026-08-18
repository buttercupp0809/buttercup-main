import { BOND_TIERS, BOND_WEIGHTS } from "@/lib/bond";

/*
 * The progression system, stated plainly before signup.
 *
 * The bond tiers already exist and drive the whole retention loop, but a visitor
 * had no way to know that, so the product read as another chat box. Competitors
 * that name their tiers out loud (bronze through diamond ladders) convert better
 * for exactly this reason: a visible ladder is a reason to come back tomorrow.
 *
 * The weights are published too. A progression system whose rules are hidden
 * feels like a slot machine; one whose rules are on the table feels like a game
 * worth playing, and it is the honest version of the same mechanic.
 */

export function BondLadder() {
  return (
    <section className="mx-auto max-w-6xl px-6 px-safe py-20">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <span className="bc-pill text-[hsl(var(--bc-honey))]">The bond</span>
          <h2 className="mt-5 max-w-[20ch] text-balance font-display text-3xl font-semibold leading-[1.05] tracking-[-0.025em] text-[hsl(var(--bc-cream))] sm:text-[2.5rem]">
            Seven tiers. She earns her way up, and so do you.
          </h2>
          <p className="mt-4 max-w-[44ch] text-pretty text-[hsl(var(--bc-muted))]">
            The bond is not a vanity number. It moves on the things that actually deepen a
            relationship, and turning up on a new day is worth more than any single message.
          </p>

          <dl className="mt-8 flex flex-col gap-px overflow-hidden rounded-[var(--bc-radius)] border border-[hsl(var(--bc-border))]">
            <WeightRow label="A message" value={BOND_WEIGHTS.message} />
            <WeightRow label="Something she remembers about you" value={BOND_WEIGHTS.memory} />
            <WeightRow label="A new day you show up" value={BOND_WEIGHTS.activeDay} highlight />
          </dl>
        </div>

        <ol className="flex flex-col">
          {BOND_TIERS.map((tier, i) => (
            <li
              key={tier.name}
              className="group relative grid grid-cols-[auto_1fr] gap-x-5 border-t border-[hsl(var(--bc-border))] py-5 first:border-t-0 first:pt-0"
            >
              {/*
                Rung marker. Fill increases with the tier so the column itself
                reads as a climb without a chart.
              */}
              <div className="flex flex-col items-center">
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full ring-1 ring-[hsl(var(--bc-amber)/0.4)]"
                  style={{
                    backgroundColor: `hsl(var(--bc-amber) / ${0.18 + (i / (BOND_TIERS.length - 1)) * 0.82})`,
                  }}
                />
                {i < BOND_TIERS.length - 1 ? (
                  <span className="mt-1 w-px flex-1 bg-[hsl(var(--bc-border))]" />
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-[hsl(var(--bc-fg))]">
                    {tier.name}
                  </h3>
                  <span className="tabular text-xs text-[hsl(var(--bc-subtle))]">
                    {tier.threshold === 0 ? "from your first hello" : `${tier.threshold} points`}
                  </span>
                </div>
                <p className="max-w-[52ch] text-pretty text-sm text-[hsl(var(--bc-muted))]">
                  {tier.blurb}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function WeightRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 bg-[hsl(var(--bc-surface)/0.6)] px-4 py-3">
      <dt className="text-sm text-[hsl(var(--bc-muted))]">{label}</dt>
      <dd
        className={
          highlight
            ? "tabular shrink-0 text-sm font-semibold text-[hsl(var(--bc-amber))]"
            : "tabular shrink-0 text-sm font-semibold text-[hsl(var(--bc-fg))]"
        }
      >
        +{value}
      </dd>
    </div>
  );
}
