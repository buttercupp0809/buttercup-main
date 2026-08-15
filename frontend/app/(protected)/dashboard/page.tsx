import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";
import { getDashboardFeed } from "@/lib/feed";
import { prisma, viewerAllowsMature } from "@buttercupp/database";
import { CharacterCard } from "@/components/gallery/CharacterCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireAuth();
  const viewer = await getViewer();
  const feed = await getDashboardFeed(viewer);
  const mature = viewerAllowsMature(viewer);
  // Phase 24: greet by the onboarding display name when present, falling
  // back to the raw email for pre-onboarding or legacy users.
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 px-safe py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          {profile?.displayName ? `Welcome back, ${profile.displayName}` : "Welcome back"}
        </h1>
        <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Signed in as {profile?.displayName || user.email}.
        </p>
      </header>

      {feed.recents.length > 0 ? (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            Continue chatting
          </h2>
          <div
            data-testid="dashboard-recents-strip"
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-safe pb-2 [-webkit-overflow-scrolling:touch]"
          >
            {feed.recents.map((r) => (
              <Link
                key={r.characterId}
                href={`/chat/${r.characterId}`}
                className="group flex w-40 shrink-0 snap-start flex-col items-center gap-2 rounded-xl border p-3 text-center transition hover:-translate-y-0.5"
                style={{
                  borderColor: "hsl(var(--buttercupp-border))",
                  backgroundColor: "hsl(var(--buttercupp-surface))",
                }}
              >
                <div
                  className="h-24 w-24 overflow-hidden rounded-full"
                  style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
                >
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt={r.characterName} className="h-full w-full object-cover object-top" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center text-lg font-semibold"
                      style={{ color: "hsl(var(--buttercupp-muted))" }}
                    >
                      {r.characterName[0]}
                    </div>
                  )}
                </div>
                <span className="text-sm font-medium">{r.characterName}</span>
                <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                  {r.messageCount} messages
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Prominent Create CTA */}
      <Link
        href="/create"
        data-testid="create-cta"
        className="group relative overflow-hidden rounded-2xl border p-6 transition hover:-translate-y-0.5"
        style={{
          borderColor: "hsl(var(--buttercupp-accent-rose) / 0.35)",
          background:
            "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.18), hsl(var(--buttercupp-accent-violet) / 0.18))",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.25)" }}
            >
              <Sparkles className="h-6 w-6" style={{ color: "hsl(var(--buttercupp-accent-rose))" }} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold">Create your companion</h2>
              <p className="mt-1 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                Design a persona with a look, voice, and personality all your own.
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-4 py-2 text-sm font-semibold text-black"
            style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Start creating
          </span>
        </div>
      </Link>

      {feed.sections.map((section) => (
        <section key={section.title}>
          <h2
            className="mb-3 font-display text-2xl font-semibold tracking-tight"
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
    </section>
  );
}
