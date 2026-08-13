import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

// DELETE /api/conversations/:id
// Deletes the conversation (and its messages via cascade) owned by the
// authenticated user. Does NOT touch the Character record.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth();
  const { id } = await params;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conv || conv.userId !== user.id) {
    return jsonError(404, "conversation_not_found");
  }

  // Delete messages first, then the conversation (avoids FK constraint issues
  // when the schema does not have cascade deletes wired).
  await prisma.message.deleteMany({ where: { conversationId: id } });
  await prisma.conversation.delete({ where: { id } });

  return new Response(null, { status: 204 });
}
