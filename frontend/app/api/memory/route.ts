import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { memoryListQuerySchema, type MemoryDTO } from "@buttercupp/shared";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireAuth();
  const url = new URL(req.url);
  const parsed = memoryListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) return jsonError(400, "invalid_query");
  const q = parsed.data;

  const where: { userId: string; characterId?: string } = { userId: user.id };
  if (q.characterId) where.characterId = assertSafeId(q.characterId, "characterId");

  const rows = await prisma.memory.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  let nextCursor: string | null = null;
  if (rows.length > q.limit) {
    // Drop the probe row, then point the cursor at the LAST ROW WE RETURNED.
    // It has to be the last returned row, not the probe: this handler resumes
    // with `cursor: { id }, skip: 1`, so naming the probe row would skip it and
    // silently lose one memory at every page boundary.
    rows.pop();
    nextCursor = rows[rows.length - 1]?.id ?? null;
  }
  const items: MemoryDTO[] = rows.map((m) => ({
    id: m.id,
    characterId: m.characterId,
    content: m.content,
    category: m.category,
    tier: m.tier,
    importance: m.importance,
    confidence: m.confidence,
    pinned: m.pinned,
    createdAt: m.createdAt.toISOString(),
    lastAccessedAt: m.lastAccessedAt?.toISOString() ?? null,
  }));
  return NextResponse.json({ items, nextCursor });
}
