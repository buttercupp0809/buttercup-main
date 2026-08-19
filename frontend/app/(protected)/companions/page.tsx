// "Your Companions": the signed-in user's owned characters, with live
// image-generation status. Additive: reuses existing owner-checked routes
// (POST /api/characters/[id]/generate-images, GET .../gallery, /chat/[id]).
// See Plans/cursor-prompt/31-your-companions-and-worker-ops.md.
import Link from "next/link";
import { Sparkles, Wand2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { listCompanions } from "@/lib/companions";
import { CompanionCard } from "@/components/companions/CompanionCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CompanionsPage() {
  const user = await requireAuth();
  const companions = await listCompanions(user.id);
  const count = companions.length;

  return (
    <section className="mx-auto max-w-6xl px-6 px-safe py-10 pb-safe sm:py-12">
      <PageHeader
        eyebrow={count === 0 ? "Studio" : `${count} companion${count === 1 ? "" : "s"}`}
        title="Your"
        accent="companions"
        description="The personas you have crafted. Chat with them, regenerate their look, or edit their soul."
        actions={
          <Link href="/create">
            <Button size="sm">
              <Wand2 className="h-4 w-4" />
              Create companion
            </Button>
          </Link>
        }
      />

      {count === 0 ? (
        <div className="buttercupp-glass bc-rise relative overflow-hidden rounded-[var(--bc-radius-2xl)] px-6 py-16 text-center sm:px-8 sm:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(30rem 20rem at 50% -10%, hsl(var(--bc-amber) / 0.18), transparent 60%), radial-gradient(30rem 20rem at 50% 110%, hsl(var(--bc-honey) / 0.14), transparent 60%)",
            }}
          />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-[var(--bc-radius-lg)] ring-1 ring-[hsl(var(--bc-amber)/0.25)]"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--bc-honey) / 0.18), hsl(var(--bc-amber) / 0.18))",
                color: "hsl(var(--bc-amber))",
                boxShadow: "var(--bc-shadow-glow)",
              }}
            >
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-balance font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              No companions yet
            </h2>
            <p className="max-w-prose text-pretty text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              Design a persona from a prompt, a photo, or a preset. In under a minute you will have a
              companion styled and voiced to your taste.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link href="/create" data-testid="companions-empty-cta">
                <Button variant="brand">
                  <Wand2 className="h-4 w-4" />
                  Create your first companion
                </Button>
              </Link>
              <Link href="/discover">
                <Button variant="outline">Browse ready-made</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {companions.map((c, i) => (
            <div
              key={c.id}
              className="bc-rise"
              style={{ "--i": i } as React.CSSProperties}
            >
              <CompanionCard companion={c} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
