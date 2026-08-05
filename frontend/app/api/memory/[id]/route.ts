import { NextResponse } from "next/server";
import { prisma } from "@poppy/database";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "memoryId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  // Load first so ownership can be checked, then delete. deleteMany with the
  // ownership predicate would also be safe, but the two-step keeps the audit
  // trail obvious. Returns 404 (not 403) when the memory is not the caller's,
  // to avoid leaking existence.
  const owned = await prisma.memory.findFirst({
    where: { id, userId: user.id },
    select: { id: true, characterId: true },
  });
  if (!owned) return jsonError(404, "not_found");

  await prisma.memory.delete({ where: { id } });

  // Fire-and-forget audit. This runs in the Next.js edge/nodejs runtime;
  // Prisma is available so the write goes straight through.
  void prisma.auditLog
    .create({
      data: {
        action: "memory.delete",
        userId: user.id,
        resource: `memory:${id}`,
        metadata: { characterId: owned.characterId },
      },
    })
    .catch(() => {
      // swallowed
    });

  return NextResponse.json({ ok: true });
}
