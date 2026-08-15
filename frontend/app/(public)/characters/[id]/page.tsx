import { notFound } from "next/navigation";
import Link from "next/link";
import { getCharacterDetail, bumpCharacterView } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { getRelationship } from "@/lib/relationship";
import { ChatCTA, type ChatCTAState } from "@/components/gallery/ChatCTA";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { GalleryPaywall } from "@/components/gallery/GalleryPaywall";
import { blurMany } from "@/lib/media-blur";
import { taglineFrom } from "@/lib/marketing";

export const dynamic = "force-dynamic";

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

  const relationship =
    viewer.id && !gated ? await getRelationship(viewer.id, detail.id) : null;

  const tagline = taglineFrom(detail.bio, 140);

  // Pre-blur every gallery image server-side. Locked tiles (index >= 1) render
  // these worthless thumbnails so the real S3 URL never reaches the browser.
  const galleryBlurs =
    detail.galleryImages.length > 0 && !gated ? await blurMany(detail.galleryImages) : [];

  return (
    <section
      className="relative min-h-screen"
      style={{ backgroundColor: "hsl(var(--buttercupp-bg))" }}
    >
      {/* Ambient glow behind the whole page */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: `
            radial-gradient(60rem 60rem at 20% 0%, hsl(var(--buttercupp-accent-rose) / 0.07) 0%, transparent 60%),
            radial-gradient(50rem 50rem at 80% 100%, hsl(var(--buttercupp-accent-violet) / 0.06) 0%, transparent 60%)
          `,
        }}
      />

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr]">

          {/* ---- Left column: portrait + CTA ---- */}
          <div className="flex flex-col gap-5">

            {/* Portrait card */}
            <div className="relative">
              {/* Soft aura glow behind the card */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-4 rounded-3xl opacity-50"
                style={{
                  background: "radial-gradient(ellipse at center, hsl(var(--buttercupp-accent-rose) / 0.22) 0%, transparent 70%)",
                  filter: "blur(24px)",
                }}
              />
              <div
                className="relative w-full overflow-hidden rounded-3xl"
                style={{
                  aspectRatio: "9 / 16",
                  border: "1px solid hsl(var(--buttercupp-border))",
                  backgroundColor: "hsl(var(--buttercupp-surface-2))",
                }}
              >
                {gated ? (
                  /* Gated: NO img element, real URL never hits the DOM */
                  <div
                    className="absolute inset-0"
                    style={{
                      background: "linear-gradient(160deg, hsl(var(--buttercupp-surface-2)) 0%, hsl(var(--buttercupp-surface)) 60%, hsl(var(--buttercupp-bg)) 100%)",
                    }}
                  />
                ) : detail.avatarUrl ? (
                  <img
                    src={detail.avatarUrl}
                    alt={detail.name}
                    className="absolute inset-0 h-full w-full object-cover object-top"
                  />
                ) : (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-5xl font-semibold"
                    style={{ color: "hsl(var(--buttercupp-muted))" }}
                  >
                    {detail.name[0]?.toUpperCase()}
                  </div>
                )}

                {/* Bottom scrim */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                {/* Name + tagline overlay */}
                <div className="absolute inset-x-4 bottom-5 flex flex-col gap-1.5 text-white">
                  <h1 className="font-display text-3xl font-bold leading-tight drop-shadow-lg md:text-4xl">
                    {detail.name}
                  </h1>
                  {tagline ? (
                    <p className="text-sm leading-relaxed text-white/80 drop-shadow-sm">{tagline}</p>
                  ) : null}
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
            </div>

            {/* CTA - no wrapper box, clean and direct */}
            <div className="flex flex-col gap-3">
              <ChatCTA state={ctaState} />
              {detail.isOwner && (
                <Link
                  href={`/create/style?editCharacterId=${detail.id}`}
                  className="rounded-md border px-4 py-2 text-center text-sm font-medium transition hover:bg-white/5"
                  style={{
                    borderColor: "hsl(var(--buttercupp-border))",
                    color: "hsl(var(--buttercupp-fg))",
                  }}
                >
                  Edit companion
                </Link>
              )}
              {!gated && (
                <p
                  className="text-center text-xs"
                  style={{ color: "hsl(var(--buttercupp-muted))" }}
                >
                  18+ only. Always in character.
                </p>
              )}
            </div>
          </div>

          {/* ---- Right column ---- */}
          {/* min-w-0 prevents the grid cell from expanding to fit gallery overflow */}
          <div className="flex min-w-0 flex-col gap-8">

            {/* Meta pills */}
            <div className="flex flex-wrap items-center gap-2">
              {[detail.creatorLabel, detail.style].map((v, i) => (
                <span
                  key={i}
                  className="rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-widest"
                  style={{
                    backgroundColor: "hsl(var(--buttercupp-surface-2))",
                    color: "hsl(var(--buttercupp-muted))",
                    border: "1px solid hsl(var(--buttercupp-border))",
                  }}
                >
                  {v}
                </span>
              ))}
            </div>

            {/* Bio */}
            <p
              className="text-base leading-8"
              style={{ color: "hsl(var(--buttercupp-fg))" }}
            >
              {detail.bio}
            </p>

            {/* Trait tags */}
            {detail.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                    style={{
                      backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.12)",
                      color: "hsl(var(--buttercupp-accent-rose))",
                      border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.25)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Age-gate warning */}
            {gated && (
              <div
                className="rounded-2xl p-4 text-sm"
                style={{
                  backgroundColor: "hsl(38 92% 50% / 0.08)",
                  border: "1px solid hsl(38 92% 50% / 0.3)",
                  color: "hsl(38 92% 70%)",
                }}
              >
                This character is 18+ only. Verify your age to see the full profile and start chatting.
              </div>
            )}

            {/* Gallery */}
            {detail.galleryImages.length > 0 && !gated && (
              <div>
                <SectionLabel>Photos</SectionLabel>
                <div className="mt-3">
                  <GalleryPaywall images={detail.galleryImages} blurs={galleryBlurs} characterName={detail.name} />
                </div>
              </div>
            )}

            {/* Personality */}
            {!gated && detail.personalitySummary && (
              <div>
                <SectionLabel>Personality</SectionLabel>
                <div
                  className="mt-3 rounded-2xl p-5 text-sm leading-7"
                  style={{
                    backgroundColor: "hsl(var(--buttercupp-surface))",
                    border: "1px solid hsl(var(--buttercupp-border))",
                    color: "hsl(var(--buttercupp-fg))",
                  }}
                >
                  {detail.personalitySummary}
                </div>
              </div>
            )}

            {/* Greeting */}
            {!gated && detail.greeting && (
              <div>
                <SectionLabel>First message</SectionLabel>
                <div
                  className="relative mt-3 rounded-2xl px-6 py-5 text-sm leading-7 italic"
                  style={{
                    backgroundColor: "hsl(var(--buttercupp-surface))",
                    border: "1px solid hsl(var(--buttercupp-border))",
                    borderLeft: "3px solid hsl(var(--buttercupp-accent-rose) / 0.6)",
                    color: "hsl(var(--buttercupp-fg))",
                  }}
                >
                  &ldquo;{detail.greeting}&rdquo;
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-semibold uppercase tracking-widest"
      style={{ color: "hsl(var(--buttercupp-muted))" }}
    >
      {children}
    </h2>
  );
}
