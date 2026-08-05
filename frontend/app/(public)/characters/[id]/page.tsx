import { notFound } from "next/navigation";
import { getCharacterDetail, bumpCharacterView } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { getRelationship } from "@/lib/relationship";
import { ChatCTA, type ChatCTAState } from "@/components/gallery/ChatCTA";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { taglineFrom } from "@/lib/marketing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Immersive persona detail. Data flow is unchanged from Phase 03: parse the
// route param, resolve the viewer, fetch the gated detail payload, fire a
// view bump, compute the CTA state. Server remains authoritative for what
// is visible; this page only renders what the DTO exposes.
export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  const detail = await getCharacterDetail(id, viewer);
  if (!detail) notFound();

  bumpCharacterView(detail.id);

  const gated = detail.requiresAgeVerification === true;

  let ctaState: ChatCTAState;
  if (viewer.id === null) ctaState = { kind: "visitor", characterId: detail.id };
  else if (gated) ctaState = { kind: "needsAgeGateMature", characterId: detail.id };
  else if (!viewer.ageVerified) ctaState = { kind: "needsAgeGate", characterId: detail.id };
  else ctaState = { kind: "eligible", characterId: detail.id };

  // Only fetch relationship for authed viewers who can actually see the
  // character clearly. Never for visitors, never through the mature gate,
  // so we cannot leak "you have chatted N times" through a blurred hero.
  const relationship =
    viewer.id && !gated ? await getRelationship(viewer.id, detail.id) : null;

  const tagline = taglineFrom(detail.bio, 140);

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-4">
          <div
            className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl ring-1"
            style={{
              backgroundColor: "hsl(var(--poppy-surface-2, 210 40% 96%))",
              borderColor: "hsl(var(--poppy-border, 214 32% 91%))",
            }}
          >
            {detail.avatarUrl ? (
              <img
                src={detail.avatarUrl}
                alt={detail.name}
                className={cn(
                  "absolute inset-0 h-full w-full object-cover",
                  gated && "scale-110 blur-lg",
                )}
              />
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center text-5xl font-semibold"
                style={{ color: "hsl(var(--poppy-muted, 215 16% 47%))" }}
              >
                {detail.name[0]?.toUpperCase()}
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <span
              aria-label={`Rating: ${detail.contentRating}`}
              className="absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/95 backdrop-blur"
            >
              {detail.contentRating}
            </span>
            <div className="absolute inset-x-4 bottom-4 flex flex-col gap-1 text-white">
              <h1 className="font-display text-3xl font-semibold leading-tight drop-shadow md:text-4xl">
                {detail.name}
              </h1>
              {tagline ? <p className="text-sm text-white/90 drop-shadow-sm">{tagline}</p> : null}
              {relationship ? (
                <div className="pt-1">
                  <AffectionMeter
                    size="sm"
                    affectionLevel={relationship.affectionLevel}
                    mood={relationship.mood}
                    milestones={relationship.milestones}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--poppy-accent-rose, 344 84% 71%) / 0.18), hsl(var(--poppy-accent-violet, 262 72% 68%) / 0.18))",
              border: "1px solid hsl(var(--poppy-accent-rose, 344 84% 71%) / 0.35)",
            }}
          >
            <ChatCTA state={ctaState} />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide" style={{ color: "hsl(var(--poppy-muted, 215 16% 47%))" }}>
            <span>{detail.creatorLabel}</span>
            <span aria-hidden>&middot;</span>
            <span>{detail.contentRating}</span>
            <span aria-hidden>&middot;</span>
            <span>{detail.style}</span>
          </div>
          <p className="text-base leading-7" style={{ color: "hsl(var(--poppy-fg, 222 47% 11%))" }}>
            {detail.bio}
          </p>
          {detail.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {detail.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full px-3 py-1 text-xs"
                  style={{
                    backgroundColor: "hsl(var(--poppy-accent-rose, 344 84% 71%) / 0.15)",
                    color: "hsl(var(--poppy-accent-rose, 344 84% 71%))",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {gated ? (
            <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-4 text-sm text-amber-200">
              This character is 18+ only. Verify your age to see the full profile and start chatting.
            </div>
          ) : (
            <>
              {detail.personalitySummary ? (
                <div>
                  <h2
                    className="mb-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "hsl(var(--poppy-muted, 215 16% 47%))" }}
                  >
                    Personality
                  </h2>
                  <p className="text-sm leading-7" style={{ color: "hsl(var(--poppy-fg, 222 47% 11%))" }}>
                    {detail.personalitySummary}
                  </p>
                </div>
              ) : null}
              {detail.greeting ? (
                <div>
                  <h2
                    className="mb-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "hsl(var(--poppy-muted, 215 16% 47%))" }}
                  >
                    Greeting
                  </h2>
                  <p
                    className="rounded-xl border p-4 italic leading-7"
                    style={{
                      borderColor: "hsl(var(--poppy-border, 214 32% 91%))",
                      backgroundColor: "hsl(var(--poppy-surface, 210 40% 96%))",
                    }}
                  >
                    &ldquo;{detail.greeting}&rdquo;
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
