import { notFound } from "next/navigation";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatList } from "@/components/chat/ChatList";
import { PersonaPanel, type PanelMedia } from "@/components/chat/PersonaPanel";
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
      media: { orderBy: [{ isPrimary: "desc" }, { sort: "asc" }] },
    },
  });
  if (!character || !character.currentVersionId) notFound();
  if (character.contentRating === "mature") {
    const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) notFound();
  }

  // Reuse the most recent open conversation or create one.
  const existing = await prisma.conversation.findFirst({
    where: { userId: user.id, characterId },
    orderBy: { lastMessageAt: "desc" },
  });
  const conv =
    existing ??
    (await prisma.conversation.create({
      data: {
        userId: user.id,
        characterId,
        characterVersionId: character.currentVersionId,
      },
    }));

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

  // Persona panel media: images -> carousel, videos -> assets strip.
  // Local paths (starting with /) are not served from S3; exclude them.
  const images = character.media
    .filter((m) => m.kind === "image" && !m.url.startsWith("/"))
    .map((m) => {
      if (m.url.startsWith("http")) return m.url;
      return signAssetUrl(m.url);
    });
  const carouselImages = images;
  const assets: PanelMedia[] = character.media
    .filter((m) => m.kind === "video")
    .map((m) => ({ kind: "video" as const, url: m.url }));
  const avatarUrl = carouselImages[0] ?? null;

  // Pre-blur gallery images server-side so locked persona-panel tiles never
  // expose a real URL. Index 0 (primary) is free; the rest render blurred.
  const imageBlurs = carouselImages.length > 1 ? await blurMany(carouselImages) : [];

  return (
    <div className="flex h-full overflow-hidden">
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
  );
}
