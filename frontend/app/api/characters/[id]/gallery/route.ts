// Per-character selfie gallery. Returns the caller's ready image assets
// for a character with fresh signed URLs. Paginated via createdAt cursor
// so infinite scroll in the SelfieGallery component works without heavy
// offset scans.

import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";
import { requireAuth, verifyAuthToken } from "@/lib/auth";
import { assertSafeId } from "@/lib/safe-types";
import { jsonError } from "@/lib/api-helpers";
import { signAssetUrl } from "@/lib/cdn";
import { z } from "zod";

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

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      url: r.s3Key ? signAssetUrl(r.s3Key) : null,
      s3Key: r.s3Key,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  });
}

const postBodySchema = z.object({
  url: z.string().min(1),
  kind: z.enum(["image", "video"]),
  isPrimary: z.boolean().optional().default(false),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authHeader = req.headers.get("authorization");
  let userId: string | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    userId = await verifyAuthToken(authHeader.slice(7));
  }
  const user = userId ? { id: userId } : await requireAuth();
  const { id: rawId } = await ctx.params;
  let characterId: string;
  try {
    characterId = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  // Verify character belongs to this user (ownerUserId, not creatorId)
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { ownerUserId: true },
  });
  if (!character || character.ownerUserId !== user.id) {
    return jsonError(403, "forbidden");
  }

  let body: z.infer<typeof postBodySchema>;
  try {
    body = postBodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "invalid_body");
  }

  if (body.isPrimary) {
    await prisma.characterMedia.updateMany({
      where: { characterId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const media = await prisma.characterMedia.create({
    data: {
      characterId,
      kind: body.kind,
      url: body.url,
      isPrimary: body.isPrimary,
      sort: 0,
      likesBase: 0,
    },
    select: { id: true, url: true, isPrimary: true },
  });

  return NextResponse.json({ id: media.id, url: media.url, isPrimary: media.isPrimary }, { status: 201 });
}
