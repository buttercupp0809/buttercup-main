import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatList, ChatListMobileTrigger } from "@/components/chat/ChatList";
import { PersonaPanel, PersonaPanelMobileTrigger, type PanelMedia } from "@/components/chat/PersonaPanel";
import { getRelationship } from "@/lib/relationship";
import { listConversations } from "@/lib/chats";
import { signAssetUrl } from "@/lib/cdn";
import { blurMany } from "@/lib/media-blur";

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

  const [relationship, conversations] = await Promise.all([
    getRelationship(user.id, characterId),
    listConversations(user.id, 50),
  ]);

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
  const carouselImages = images;
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
        Compact mobile/tablet chat top-bar: a Back control plus the two
        panel triggers. Hidden entirely at xl+, where both ChatList (from
        lg) and PersonaPanel (from xl) already render inline below.
      */}
      <div
        className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1 pt-safe xl:hidden"
        style={{ borderColor: "hsl(var(--buttercupp-border))" }}
      >
        <div className="flex items-center gap-1">
          <Link
            href="/chats"
            aria-label="Back to chats"
            className="tap-target flex items-center justify-center rounded-md text-white lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ChatListMobileTrigger conversations={conversations} activeCharacterId={characterId} />
        </div>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-white/80">
          {character.name}
        </span>
        <PersonaPanelMobileTrigger
          name={character.name}
          description={character.bio}
          location={character.location}
          images={carouselImages}
          imageBlurs={imageBlurs}
          assets={assets}
        />
      </div>

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
          />
        </div>

        <PersonaPanel
          name={character.name}
          description={character.bio}
          location={character.location}
          images={carouselImages}
          imageBlurs={imageBlurs}
          assets={assets}
        />
      </div>
    </div>
  );
}
