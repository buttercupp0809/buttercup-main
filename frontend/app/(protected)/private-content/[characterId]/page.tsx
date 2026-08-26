import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma, CHARACTER_MEDIA_ORDER_BY } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { signAssetUrl } from "@/lib/cdn";
import { blurMany } from "@/lib/media-blur";
import {
  PrivateContentGallery,
  type PrivateLockedTile,
  type PrivateUnlockedTile,
} from "@/components/gallery/PrivateContentGallery";

export const dynamic = "force-dynamic";

// Private content page: shows ALL of a character's paywalled media.
//
// Product decision: exactly ONE free display image is shown clearly; every
// other media item is blurred + locked and links to /billing. This replaces the
// old behavior where the "Private Content" button went straight to /billing.
//
// SECURITY: only the single free image is signed. Locked media are never signed
// and their real URLs / S3 keys never reach the DOM; they render server-blurred
// placeholders (blurMany) with a lock/play badge. Same pattern as
// GalleryPaywall and the chat PersonaPanel.
export default async function PrivateContentPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const user = await requireAuth();

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      media: {
        // hidden: false is load-bearing (HIDDEN MEDIA CONVENTION in
        // schema.prisma). Ordering from the canonical constant so this read
        // site can never drift from the others.
        where: { hidden: false },
        orderBy: CHARACTER_MEDIA_ORDER_BY,
      },
    },
  });
  if (!character || !character.currentVersionId) notFound();

  // Mature characters are age-gated exactly like the chat page.
  if (character.contentRating === "mature") {
    const verified =
      user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) notFound();
  }

  // The single FREE image is the first image-kind row that is isMain or
  // isDisplay. CHARACTER_MEDIA_ORDER_BY already sorts isMain, then isDisplay,
  // then isPrimary, then sort, so the first qualifying image is the intended
  // free asset. Fall back to the first image row if a character somehow has
  // no explicit free flag set. Everything else stays locked/paywalled.
  const images = character.media.filter((m) => m.kind === "image");
  const freeMedia =
    images.find((m) => m.isMain || m.isDisplay) ?? images[0] ?? null;

  // Sign ONLY the free asset. Local public paths (/personas/x.webp) and full
  // http(s) URLs (seed stock art) pass through unsigned, matching every other
  // read site; bare S3 keys get a signed CloudFront URL.
  let freeImageUrl: string | null = null;
  if (freeMedia) {
    freeImageUrl =
      freeMedia.url.startsWith("/") || freeMedia.url.startsWith("http")
        ? freeMedia.url
        : signAssetUrl(freeMedia.url);
  }

  // Everything except the free asset is locked. We blur their real URLs
  // server-side and expose ONLY the resulting data URIs, never the real URL.
  const lockedMedia = character.media.filter((m) => m.id !== freeMedia?.id);

  // Check which locked media this user has already unlocked.
  const lockedMediaIds = lockedMedia.map((m) => m.id);
  const [sub, alreadyUnlocked] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId: user.id },
      select: { status: true },
    }),
    lockedMediaIds.length > 0
      ? prisma.userUnlockedMedia.findMany({
          where: { userId: user.id, characterMediaId: { in: lockedMediaIds } },
          select: { characterMediaId: true },
        })
      : Promise.resolve([]),
  ]);
  const hasActivePlan = sub?.status === "active";
  const unlockedIdSet = new Set(alreadyUnlocked.map((u) => u.characterMediaId));

  // Build unlocked tiles with signed URLs and locked tiles with blurred data URIs.
  const stillLockedMedia = lockedMedia.filter((m) => !unlockedIdSet.has(m.id));
  const unlockedMedia = lockedMedia.filter((m) => unlockedIdSet.has(m.id));

  const lockedBlurs = await blurMany(stillLockedMedia.map((m) => m.url));
  const lockedTiles: PrivateLockedTile[] = stillLockedMedia.map((m, i) => ({
    id: m.id,
    kind: m.kind === "video" ? "video" : "image",
    blur: lockedBlurs[i],
  }));

  const unlockedTiles: PrivateUnlockedTile[] = unlockedMedia.map((m) => ({
    id: m.id,
    kind: m.kind === "video" ? "video" : "image",
    url:
      m.url.startsWith("/") || m.url.startsWith("http")
        ? m.url
        : signAssetUrl(m.url),
  }));

  const hasAnything = Boolean(freeImageUrl) || lockedTiles.length > 0 || unlockedTiles.length > 0;

  return (
    <section className="mx-auto max-w-5xl px-6 py-6 sm:py-8">
      <div className="mb-4">
        <Link
          href={`/chat/${characterId}`}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--bc-muted))] transition-colors hover:text-[hsl(var(--bc-fg))]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </Link>
      </div>

      <PageHeader
        eyebrow="Private content"
        title={character.name}
        description={hasActivePlan ? "Tap any locked image to unlock it for 1 image token." : "One preview is on the house. Unlock everything else with a subscription."}
      />

      {hasAnything ? (
        <PrivateContentGallery
          characterName={character.name}
          characterId={characterId}
          freeImageUrl={freeImageUrl}
          lockedTiles={lockedTiles}
          unlockedTiles={unlockedTiles}
          hasActivePlan={hasActivePlan}
        />
      ) : (
        <p className="text-sm text-[hsl(var(--bc-muted))]">
          {character.name} has no private content yet.
        </p>
      )}
    </section>
  );
}
