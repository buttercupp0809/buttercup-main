// Per-character selfie gallery. Returns the caller's ready image assets
// for a character with fresh signed URLs. Paginated via createdAt cursor
// so infinite scroll in the SelfieGallery component works without heavy
// offset scans.

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@buttercupp/database";
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
  isDisplay: z.boolean().optional().default(false),
});

// LEGACY (Phase 28): this callback used to be how the detached
// persona_pipeline.py subprocess reported create-time images back. Creation
// images now go through the Phase-07 media queue (see
// frontend/app/api/characters/[id]/generate-images/route.ts +
// backend/src/queue/media-worker.ts), which is the only writer of
// create-time CharacterMedia rows. This endpoint is gated off by default so
// there is a single writer for that event; it is kept (rather than deleted)
// for any offline/manual tooling that still wants to POST a media asset
// directly (e.g. a manual Plans/inference-aws/persona_pipeline.py run).
// Set ENABLE_LEGACY_PERSONA_CALLBACK=true to re-enable.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_LEGACY_PERSONA_CALLBACK !== "true") {
    return jsonError(410, "legacy_endpoint_disabled", {
      message:
        "Creation-time images now go through the media queue; this callback is retired by default.",
    });
  }
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

  // Single-winner writes: at most one isPrimary (hero) and one isDisplay
  // (free/public) row per character. Clearing the previous winner(s) and
  // creating the new row happen in one transaction so a crash never leaves
  // two winners.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (body.isPrimary) {
    ops.push(
      prisma.characterMedia.updateMany({
        where: { characterId, isPrimary: true },
        data: { isPrimary: false },
      }),
    );
  }
  if (body.isDisplay) {
    ops.push(
      prisma.characterMedia.updateMany({
        where: { characterId, isDisplay: true },
        data: { isDisplay: false },
      }),
    );
  }
  ops.push(
    prisma.characterMedia.create({
      data: {
        characterId,
        kind: body.kind,
        url: body.url,
        isPrimary: body.isPrimary,
        isDisplay: body.isDisplay,
        sort: 0,
        likesBase: 0,
      },
      select: { id: true, url: true, isPrimary: true, isDisplay: true },
    }),
  );

  const results = await prisma.$transaction(ops);
  const media = results[results.length - 1] as {
    id: string;
    url: string;
    isPrimary: boolean;
    isDisplay: boolean;
  };

  return NextResponse.json(
    { id: media.id, url: media.url, isPrimary: media.isPrimary, isDisplay: media.isDisplay },
    { status: 201 },
  );
}
