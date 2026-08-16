// "Your Companions": the signed-in user's owned characters, with live
// image-generation status. Additive: reuses existing owner-checked routes
// (POST /api/characters/[id]/generate-images, GET .../gallery, /chat/[id]).
// See Plans/cursor-prompt/31-your-companions-and-worker-ops.md.
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listCompanions } from "@/lib/companions";
import { CompanionCard } from "@/components/companions/CompanionCard";

export const dynamic = "force-dynamic";

export default async function CompanionsPage() {
  const user = await requireAuth();
  const companions = await listCompanions(user.id);

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Your Companions</h1>
        <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {companions.length === 0
            ? "Characters you create will appear here."
            : `${companions.length} companion${companions.length === 1 ? "" : "s"} you created.`}
        </p>
      </div>

      {companions.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border p-12 text-center"
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface))",
            borderColor: "hsl(var(--buttercupp-border))",
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold">No companions yet</h2>
            <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Design a persona from a prompt, a photo, or a preset in the wizard.
            </p>
          </div>
          <Link
            href="/create"
            data-testid="companions-empty-cta"
            className="tap-target inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white shadow"
            style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Create your first companion
          </Link>
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
