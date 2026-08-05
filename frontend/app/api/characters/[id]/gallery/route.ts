// Per-character selfie gallery. Returns the caller's ready image assets
// for a character with fresh signed URLs. Paginated via createdAt cursor
// so infinite scroll in the SelfieGallery component works without heavy
// offset scans.

import { NextResponse } from "next/server";
import { prisma } from "@poppy/database";
import { requireAuth } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let characterId: string;
  try {
    characterId = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }
  const url = new URL(req.url);
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));
  const cursor = url.searchParams.get("cursor");

  const rows = await prisma.mediaAsset.findMany({
    where: { userId: user.id, characterId, kind: "image", status: "ready" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const overflow = rows.pop();
    nextCursor = overflow?.id ?? null;
  }

  // Sign URLs in the frontend runtime is fine (Node runtime); backend
  // helper only exists there. For simplicity we return the S3 key and let
  // the frontend hit the backend status route for a signed URL when the
  // client asks for it. The status route is cheap.
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      s3Key: r.s3Key,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  });
}
