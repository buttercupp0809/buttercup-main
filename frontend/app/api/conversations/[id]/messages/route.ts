import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "conversationId");
  } catch {
    return jsonError(400, "invalid_id");
  }
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 50) || 50);

  const owned = await prisma.conversation.findFirst({ where: { id, userId: user.id } });
  if (!owned) return jsonError(404, "not_found");

  const rows = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const overflow = rows.pop();
    nextCursor = overflow?.id ?? null;
  }
  return NextResponse.json({
    items: rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    nextCursor,
  });
}
