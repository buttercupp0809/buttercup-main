import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";
import { getDashboardFeed } from "@/lib/feed";
import { getUserProgress, getBondsForCharacters } from "@/lib/progress";
import { prisma, viewerAllowsMature } from "@buttercupp/database";
import { CharacterCard } from "@/components/gallery/CharacterCard";
import { BondMeter, BondPill } from "@/components/progress/BondMeter";
import { StreakBadge } from "@/components/progress/StreakBadge";
import { DailyQuests } from "@/components/progress/DailyQuests";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireAuth();
  const viewer = await getViewer();
  const feed = await getDashboardFeed(viewer);
  const mature = viewerAllowsMature(viewer);
  // Phase 24: greet by the onboarding display name when present, falling
  // back to the raw email for pre-onboarding or legacy users.
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });

  // Progression is derived read-only from conversations, memories and message
  // timestamps (see lib/progress.ts). Nothing here writes.
  const progress = await getUserProgress(user.id);
  const bonds = await getBondsForCharacters(
    user.id,
    feed.recents.map((r) => r.characterId),
  );

  const firstName = profile?.displayName?.split(" ")[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 px-safe py-8">
      {/*
       * Asymmetric masthead: the greeting and the bond own the wide left column
       * while the streak and today's quests stack in the narrow right one. A
       * centred hero here would waste the one moment the user is guaranteed to
       * look at, which is the status of the relationship they came back for.
       */}
      <section className="grid gap-6 lg:grid-cols-[1.55fr_1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[hsl(var(--bc-subtle))]">
              {greeting()}
            </p>
            <h1 className="mt-2 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              {firstName ? (
                <>
                  Welcome back, <span className="text-[hsl(var(--bc-honey))]">{firstName}</span>
                </>
              ) : (
                "Welcome back"
              )}
            </h1>
          </header>

          <div className="buttercupp-glass rounded-[var(--bc-radius-xl)] p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--bc-subtle))]">
                Your bond
              </h2>
              <span className="tabular text-xs text-[hsl(var(--bc-subtle))]">
                {progress.totals.companions}{" "}
                {progress.totals.companions === 1 ? "companion" : "companions"}
              </span>
            </div>
            <div className="mt-4">
              <BondMeter bond={progress.overall} memoryCount={progress.totals.memories} />
            </div>
            <dl
              className="mt-5 grid grid-cols-3 gap-4 border-t pt-4"
              style={{ borderColor: "hsl(var(--bc-border))" }}
            >
              <Stat label="Messages" value={progress.totals.messages} />
              <Stat label="Memories" value={progress.totals.memories} />
              <Stat label="Best streak" value={progress.streak.best} />
            </dl>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <StreakBadge streak={progress.streak} />
          <DailyQuests quests={progress.quests} />
        </div>
      </section>

      {feed.recents.length > 0 ? (
        <section>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Pick up where you left off
            </h2>
            <Link
              href="/chats"
              className="group inline-flex items-center gap-1 text-sm text-[hsl(var(--bc-muted))] transition-colors duration-200 hover:text-[hsl(var(--bc-honey))]"
            >
              All chats
              <ArrowRight
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
          <div
            data-testid="dashboard-recents-strip"
            // --bc-gutter:0 opts out of the .px-safe gutter floor; the page
            // container already provides the horizontal padding.
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-safe pb-2 [--bc-gutter:0px] [-webkit-overflow-scrolling:touch]"
          >
            {feed.recents.map((r, i) => {
              const bond = bonds.get(r.characterId);
              return (
                <Link
                  key={r.characterId}
                  href={`/chat/${r.characterId}`}
                  className="bc-rise bc-press group flex w-[13.5rem] shrink-0 snap-start flex-col gap-3 rounded-[var(--bc-radius-lg)] border p-4 transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5"
                  style={
                    {
                      "--i": i,
                      borderColor: "hsl(var(--bc-border))",
                      backgroundColor: "hsl(var(--bc-surface) / 0.7)",
                    } as React.CSSProperties
                  }
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="bc-image-edge size-14 shrink-0 overflow-hidden rounded-full"
                      style={{ backgroundColor: "hsl(var(--bc-surface-2))" }}
                    >
                      {r.avatarUrl ? (
                        <img
                          src={r.avatarUrl}
                          alt={r.characterName}
                          className="size-full object-cover object-top"
                        />
                      ) : (
                        <div className="grid size-full place-items-center font-display text-lg font-semibold text-[hsl(var(--bc-muted))]">
                          {r.characterName[0]}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.characterName}</p>
                      <p className="tabular mt-0.5 text-xs text-[hsl(var(--bc-subtle))]">
                        {r.messageCount} messages
                      </p>
                    </div>
                  </div>
                  {bond ? <BondPill bond={bond} className="self-start" /> : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <Link
        href="/create"
        data-testid="create-cta"
        className="bc-press group relative overflow-hidden rounded-[var(--bc-radius-xl)] border p-6 transition-[border-color,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5"
        style={{
          borderColor: "hsl(var(--bc-amber) / 0.3)",
          background:
            "linear-gradient(115deg, hsl(var(--bc-amber) / 0.14), hsl(var(--bc-honey) / 0.06) 60%, transparent)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-[var(--bc-radius)]"
              style={{ backgroundColor: "hsl(var(--bc-amber) / 0.18)" }}
            >
              <Sparkles
                className="size-6"
                strokeWidth={2}
                style={{ color: "hsl(var(--bc-honey))" }}
                aria-hidden="true"
              />
            </span>
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Create your companion
              </h2>
              <p className="mt-1 max-w-[52ch] text-pretty text-sm text-[hsl(var(--bc-muted))]">
                Design a persona with a look, voice, and personality all your own.
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ backgroundColor: "hsl(var(--bc-amber))", color: "hsl(28 45% 9%)" }}
          >
            Start creating
          </span>
        </div>
      </Link>

      {feed.sections.map((section) => (
        <section key={section.title}>
          <h2
            className="mb-4 font-display text-2xl font-semibold tracking-tight"
            data-testid={`feed-${section.title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {section.title}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
            {section.items.map((c) => (
              <CharacterCard key={c.id} character={c} viewerAllowsMature={mature} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--bc-subtle))]">
        {label}
      </dt>
      <dd className="tabular mt-1 font-display text-xl font-semibold text-[hsl(var(--bc-fg))]">
        {value}
      </dd>
    </div>
  );
}

// Server-rendered, so this reflects the server's clock rather than the visitor's.
// Close enough for a greeting, and it avoids shipping a client component purely
// to read the time of day.
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
