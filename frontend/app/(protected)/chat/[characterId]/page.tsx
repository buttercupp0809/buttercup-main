import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/constants";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatList, ChatListMobileTrigger } from "@/components/chat/ChatList";
import { PersonaPanel, PersonaPanelMobileTrigger, type PanelMedia } from "@/components/chat/PersonaPanel";
import { getRelationship } from "@/lib/relationship";
import { listConversations } from "@/lib/chats";
import { getCompanionBond } from "@/lib/progress";
import { getCompanionMemories } from "@/lib/memories";
import { freeHeadroom } from "@/lib/bond";
import { signAssetUrl } from "@/lib/cdn";
import { blurMany } from "@/lib/media-blur";
import { dedupeByIdentity, excludeHeroIdentity } from "@/lib/character-media";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const user = await requireAuth();

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      currentVersion: { include: { appearanceSheet: true } },
      media: {
        // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
        // schema.prisma. Without this, the now-retired external reference
        // image (never hidden from this query before) could still win the
        // images[0]/avatarUrl slot below.
        where: { hidden: false },
        orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { sort: "asc" }],
      },
    },
  });
  if (!character || !character.currentVersionId) notFound();
  if (character.contentRating === "mature") {
    const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) notFound();
  }

  // Reuse the most recent open conversation or create one. upsert (not a
  // find-then-create check) so two near-simultaneous loads of the same chat
  // (double-click, tab duplication, a prefetch racing the real navigation)
  // cannot both pass the "does it exist" check and then both try to create,
  // which would trip the (userId, characterId) unique constraint.
  const conv = await prisma.conversation.upsert({
    where: { userId_characterId: { userId: user.id, characterId } },
    create: {
      userId: user.id,
      characterId,
      characterVersionId: character.currentVersionId,
    },
    update: {},
  });

  // Best-effort active check-in. Runs server-side against the backend so the
  // client never sees a round trip, and any error (backend down, LLM chain
  // failing without a greeting fallback) is swallowed so the chat page still
  // opens. maybeRunCheckin is idempotent, so racing this call with another
  // open of the same chat cannot double-write.
  try {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    const jar = await cookies();
    const auth = jar.get(AUTH_COOKIE)?.value;
    if (auth) {
      await fetch(`${backendUrl}/chat/checkin`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_COOKIE}=${encodeURIComponent(auth)}`,
        },
        body: JSON.stringify({ conversationId: conv.id }),
        cache: "no-store",
      });
    }
  } catch {
    // Best effort; the chat page must always render.
  }

  const historyRows = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { mediaAsset: { select: { s3Key: true } } },
  });
  const initialMessages = historyRows.reverse().map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    // Production: sign the S3 key from the linked MediaAsset.
    // Local dev fallback: if content is a data URL (no S3), use it directly.
    imageUrl: m.mediaAsset?.s3Key
      ? signAssetUrl(m.mediaAsset.s3Key)
      : m.content.startsWith("data:")
        ? m.content
        : undefined,
  }));

  const [relationship, conversations, bond, memories, quota] = await Promise.all([
    getRelationship(user.id, characterId),
    listConversations(user.id, 50),
    getCompanionBond(user.id, characterId),
    getCompanionMemories(user.id, characterId),
    // Read-only view of the free-trial counter the backend enforces. Presentation
    // only: the server still decides when to refuse a turn.
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        freeMessagesUsed: true,
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true } },
      },
    }),
  ]);

  const onPaidPass =
    quota?.subscription?.status === "active" &&
    quota.subscription.plan !== null &&
    quota.subscription.plan !== "free" &&
    (quota.subscription.currentPeriodEnd === null ||
      quota.subscription.currentPeriodEnd.getTime() > Date.now());
  const headroom = onPaidPass ? null : freeHeadroom(quota?.freeMessagesUsed ?? 0);

  // Persona panel media: images -> carousel, videos -> assets strip. Local
  // paths (starting with /) are Next.js public/ static files (seed stock
  // art), not secret, and must pass through unsigned like every other read
  // site (lib/feed.ts, lib/chats.ts, lib/reels/data.ts) does. Dropping them
  // here previously meant a character whose free/display image happened to
  // be a local path fell through to the isPrimary hero as images[0], which
  // leaked the paywalled asset as the clear chat avatar. That must never
  // happen: images[0] has to be exactly the display asset the query already
  // sorted to the front, local or not.
  const images = character.media
    .filter((m) => m.kind === "image")
    .map((m) => {
      if (m.url.startsWith("/") || m.url.startsWith("http")) return m.url;
      return signAssetUrl(m.url);
    });
  // Dedup the panel image list by media identity (last segment of the key).
  // The seed writes byte-identical PNGs to two different owner-prefixed keys
  // and assigns one to isDisplay (index 0 here) and the other to isPrimary
  // (index 1 here), so string-equality dedup fails and images[1] leaks the
  // same picture as images[0] into the free gallery tile above the paywall.
  // Filtering by `mediaIdentity` normalizes to the last path segment which
  // is stable across owner prefix, signing tokens, and the /api/media proxy.
  // See frontend/lib/character-media.ts.
  const dedupedImages: string[] = dedupeByIdentity(images);
  const heroUrl: string | null = dedupedImages[0] ?? null;
  const galleryTail: string[] = excludeHeroIdentity(heroUrl, dedupedImages.slice(1));
  const carouselImages: string[] = heroUrl ? [heroUrl, ...galleryTail] : [];
  const assets: PanelMedia[] = character.media
    .filter((m) => m.kind === "video")
    .map((m) => ({ kind: "video" as const, url: m.url }));
  const avatarUrl = carouselImages[0] ?? null;

  // Pre-blur gallery images server-side so locked persona-panel tiles never
  // expose a real URL. Index 0 (the free/display image) is free; the rest
  // (including the isPrimary hero, now at index 1+) render blurred.
  const imageBlurs = carouselImages.length > 1 ? await blurMany(carouselImages) : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        No separate mobile top strip. Below xl the two panel triggers and the
        Back control are handed to ChatWindow and rendered inside its header, so
        a phone shows one chat bar instead of three stacked ones.
      */}
      <div className="flex flex-1 overflow-hidden">
        <ChatList conversations={conversations} activeCharacterId={characterId} />

        <div className="min-w-0 flex-1">
          <ChatWindow
            conversationId={conv.id}
            initialMessages={initialMessages}
            characterName={character.name}
            wsUrl={process.env.NEXT_PUBLIC_WS_URL}
            avatarUrl={avatarUrl}
            relationship={relationship}
            bond={bond}
            greeting={character.currentVersion?.greeting ?? null}
            headroom={headroom}
            mobileLeading={
              <>
                <Link
                  href="/chats"
                  aria-label="Back to chats"
                  className="tap-target flex items-center justify-center rounded-md text-white lg:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <ChatListMobileTrigger
                  conversations={conversations}
                  activeCharacterId={characterId}
                />
              </>
            }
            mobileTrailing={
              <PersonaPanelMobileTrigger
                name={character.name}
                description={character.bio}
                location={character.location}
                images={carouselImages}
                imageBlurs={imageBlurs}
                assets={assets}
                characterId={characterId}
                memories={memories.items}
                memoryCursor={memories.nextCursor}
                memoryTotal={memories.total}
              />
            }
          />
        </div>

        <PersonaPanel
          name={character.name}
          description={character.bio}
          location={character.location}
          images={carouselImages}
          imageBlurs={imageBlurs}
          assets={assets}
          characterId={characterId}
          memories={memories.items}
          memoryCursor={memories.nextCursor}
          memoryTotal={memories.total}
        />
      </div>
    </div>
  );
}
