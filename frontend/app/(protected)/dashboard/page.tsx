import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAgeVerified } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";
import { getDashboardFeed } from "@/lib/feed";
import { viewerAllowsMature } from "@poppy/database";
import { CharacterCard } from "@/components/gallery/CharacterCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireAgeVerified();
  const viewer = await getViewer();
  const feed = await getDashboardFeed(viewer);
  const mature = viewerAllowsMature(viewer);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
          Signed in as {user.email}.
        </p>
      </header>

      {feed.recents.length > 0 ? (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "hsl(var(--poppy-muted))" }}
          >
            Continue chatting
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {feed.recents.map((r) => (
              <Link
                key={r.characterId}
                href={`/chat/${r.characterId}`}
                className="group flex w-40 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 text-center transition hover:-translate-y-0.5"
                style={{
                  borderColor: "hsl(var(--poppy-border))",
                  backgroundColor: "hsl(var(--poppy-surface))",
                }}
              >
                <div
                  className="h-24 w-24 overflow-hidden rounded-full"
                  style={{ backgroundColor: "hsl(var(--poppy-surface-2))" }}
                >
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt={r.characterName} className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center text-lg font-semibold"
                      style={{ color: "hsl(var(--poppy-muted))" }}
                    >
                      {r.characterName[0]}
                    </div>
                  )}
                </div>
                <span className="text-sm font-medium">{r.characterName}</span>
                <span className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
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
          borderColor: "hsl(var(--poppy-accent-rose) / 0.35)",
          background:
            "linear-gradient(135deg, hsl(var(--poppy-accent-rose) / 0.18), hsl(var(--poppy-accent-violet) / 0.18))",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: "hsl(var(--poppy-accent-rose) / 0.25)" }}
            >
              <Sparkles className="h-6 w-6" style={{ color: "hsl(var(--poppy-accent-rose))" }} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold">Create your companion</h2>
              <p className="mt-1 text-sm" style={{ color: "hsl(var(--poppy-muted))" }}>
                Design a persona with a look, voice, and personality all your own.
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-4 py-2 text-sm font-semibold text-black"
            style={{ backgroundColor: "hsl(var(--poppy-accent-rose))" }}
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {section.items.map((c) => (
              <CharacterCard key={c.id} character={c} viewerAllowsMature={mature} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
