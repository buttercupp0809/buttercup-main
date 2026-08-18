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
    <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
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
        <div className="buttercupp-glass relative overflow-hidden rounded-3xl px-8 py-14 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(30rem 20rem at 50% -10%, hsl(var(--buttercupp-accent-rose) / 0.18), transparent 60%), radial-gradient(30rem 20rem at 50% 110%, hsl(var(--buttercupp-accent-violet) / 0.14), transparent 60%)",
            }}
          />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(344 84% 71% / 0.18), hsl(262 72% 68% / 0.18))",
                color: "hsl(var(--buttercupp-accent-rose))",
              }}
            >
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              No companions yet
            </h2>
            <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Design a persona from a prompt, a photo, or a preset. In under a minute you will have a
              companion styled and voiced to your taste.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link href="/create" data-testid="companions-empty-cta">
                <Button>
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
          {companions.map((c) => (
            <CompanionCard key={c.id} companion={c} />
          ))}
        </div>
      )}
    </section>
  );
}
