import { notFound } from "next/navigation";
import { prisma } from "@poppy/database";
import { requireAgeVerified } from "@/lib/auth";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { getRelationship } from "@/lib/relationship";

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

  const relationship = await getRelationship(user.id, characterId);
  const avatarKeys = character.currentVersion?.appearanceSheet?.referenceImageKeys ?? [];
  const cf = process.env.CLOUDFRONT_URL;
  const avatarUrl = avatarKeys[0]
    ? cf
      ? `${cf.replace(/\/$/, "")}/${avatarKeys[0]}`
      : avatarKeys[0]
    : null;

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <ChatWindow
        conversationId={conv.id}
        initialMessages={initialMessages}
        characterName={character.name}
        wsUrl={process.env.NEXT_PUBLIC_WS_URL}
        avatarUrl={avatarUrl}
        relationship={relationship}
      />
    </section>
  );
}
