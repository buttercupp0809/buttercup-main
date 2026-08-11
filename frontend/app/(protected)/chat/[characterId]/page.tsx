import { notFound } from "next/navigation";
import { prisma } from "@buttercupp/database";
import { requireAgeVerified } from "@/lib/auth";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatList } from "@/components/chat/ChatList";
import { PersonaPanel, type PanelMedia } from "@/components/chat/PersonaPanel";
import { getRelationship } from "@/lib/relationship";
import { listConversations } from "@/lib/chats";
import { pickPersonaImage } from "@/lib/persona-images";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const user = await requireAgeVerified();

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
  });
  const initialMessages = historyRows.reverse().map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  const [relationship, conversations] = await Promise.all([
    getRelationship(user.id, characterId),
    listConversations(user.id, 50),
  ]);

  // Persona panel media: images -> carousel, videos -> assets strip.
  const images = character.media.filter((m) => m.kind === "image").map((m) => m.url);
  const carouselImages = images.length > 0 ? images : [pickPersonaImage(characterId)];
  const assets: PanelMedia[] = character.media
    .filter((m) => m.kind === "video")
    .map((m) => ({ kind: "video" as const, url: m.url }));
  const avatarUrl = carouselImages[0];

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
        assets={assets}
      />
    </div>
  );
}
