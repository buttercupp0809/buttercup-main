// HTTP endpoints for the media pipeline. Live on the backend service so the
// worker/queue infrastructure stays out of the Next.js runtime. Frontend
// proxies to /media/... via a Next route (or the client calls the backend
// directly with the same cookie).
//
// Routes:
//   POST /media/:kind  -> enqueue (Zod-validated). Pre-checks balance, 402
//                         paywall response on shortfall.
//   GET  /media/:id    -> status + fresh signed URL when ready.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import {
  enqueueMediaRequestSchema,
  mediaKindSchema,
  MEDIA_TOKEN_COSTS,
  CREATION_IMAGE_COUNT,
  type EnqueueMediaResponse,
  type MediaKind,
  type CreationImageJobPayload,
} from "@buttercupp/shared";
import { prisma } from "@buttercupp/database";
import { createQueuedAsset } from "../media/asset";
import { enqueueMediaJob } from "../queue/media-queue";
import { getSignedUrl } from "../media/storage";
import { isRedisConfigured } from "../queue/connection";
import { assertSafeId } from "../utils/safe-types";
import { assertCanConsumeMedia, PaywallError } from "../subscription/enforce";
import { writeAuditLog } from "../utils/audit";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1));
  }
  return out;
}

async function authenticate(req: IncomingMessage): Promise<string | null> {
  const token = parseCookies(req.headers.cookie)["buttercupp_auth"];
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET), {
      audience: "buttercupp:auth",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += String(c)));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleEnqueue(req: IncomingMessage, res: ServerResponse, kind: MediaKind) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });

  let body;
  try {
    body = enqueueMediaRequestSchema.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: "invalid_body", message: String(e) });
  }

  // Phase 21 plan gate. Runs BEFORE the token-balance check so a user
  // without an active plan sees a paywall (upgrade prompt) rather than an
  // "insufficient tokens" error that suggests buying a token pack. Voice
  // is not plan-quota-gated; only image/video are.
  if (kind === "image" || kind === "video") {
    try {
      await assertCanConsumeMedia(userId, kind);
    } catch (err) {
      if (err instanceof PaywallError) {
        writeAuditLog({
          userId,
          action: "media.paywall_block",
          resource: `media:${kind}`,
        });
        return send(res, err.status, err.body);
      }
      throw err;
    }
  }

  const cost = MEDIA_TOKEN_COSTS[kind];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenBalance: true },
  });
  if (!user) return send(res, 401, { error: "unauthorized" });
  if (user.tokenBalance < cost) {
    return send(res, 402, {
      error: "insufficient_tokens",
      required: cost,
      balance: user.tokenBalance,
      buyTokensUrl: "/billing/tokens",
    });
  }

  const characterId = body.characterId ? assertSafeId(body.characterId, "characterId") : null;
  const conversationId = body.conversationId ? assertSafeId(body.conversationId, "conversationId") : null;

  const asset = await createQueuedAsset({
    userId,
    characterId,
    kind,
    meta: { payload: body.payload },
  });
  const { jobId } = await enqueueMediaJob({
    mediaAssetId: asset.id,
    userId,
    conversationId,
    characterId,
    kind,
    tokenCost: cost,
    payload: body.payload,
  });
  const resp: EnqueueMediaResponse = { jobId, mediaAssetId: asset.id, status: "queued" };
  return send(res, 202, resp);
}

// Phase 28: creation-time image enqueue. The frontend wizard's
// generate-images route (frontend/app/api/characters/[id]/generate-images/
// route.ts) calls this so the SAME BullMQ queue + Phase-09 imageHandler
// chat selfies use also produces a character's initial (or post-edit)
// portrait set, replacing the old detached persona_pipeline.py subprocess.
// Auth mirrors the rest of this file: cookie JWT, verified independently of
// whatever the frontend already checked (defense in depth), since this is a
// service-to-service call authenticated with a freshly minted short-lived
// token, not a browser session.
async function handleCreationImagesEnqueue(
  req: IncomingMessage,
  res: ServerResponse,
  rawCharacterId: string,
) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });

  let characterId: string;
  try {
    characterId = assertSafeId(rawCharacterId, "characterId");
  } catch {
    return send(res, 400, { error: "invalid_id" });
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, ownerUserId: true, currentVersionId: true },
  });
  if (!character) return send(res, 404, { error: "character_not_found" });
  if (character.ownerUserId !== userId) return send(res, 403, { error: "forbidden" });
  if (!character.currentVersionId) return send(res, 409, { error: "no_current_version" });

  // No worker can ever drain this queue without Redis. Rather than leave
  // MediaAsset rows queued forever, skip creating them and tell the caller
  // generation is unavailable in this environment; the wizard stays
  // non-blocking either way (see generate-images/route.ts).
  if (!isRedisConfigured()) {
    return send(res, 200, {
      status: "unavailable",
      message: "REDIS_URL not configured; creation-time generation is skipped in this environment.",
    });
  }

  const characterVersionId = character.currentVersionId;
  const assetIds: string[] = [];
  for (let variant = 0; variant < CREATION_IMAGE_COUNT; variant++) {
    const asset = await createQueuedAsset({
      userId,
      characterId,
      kind: "image",
      meta: { source: "creation", variant, characterVersionId },
    });
    const payload: CreationImageJobPayload = {
      source: "creation",
      characterId,
      characterVersionId,
      variant,
      userRequest: "",
    };
    // Creation images are free: tokenCost 0 (see token-ledger.ts's
    // zero-delta short-circuit). Only chat selfies debit IMAGE_TOKEN_COST.
    await enqueueMediaJob({
      mediaAssetId: asset.id,
      userId,
      conversationId: null,
      characterId,
      kind: "image",
      tokenCost: 0,
      payload,
    });
    assetIds.push(asset.id);
  }

  return send(res, 202, { status: "queued", assetIds });
}

async function handleStatus(req: IncomingMessage, res: ServerResponse, id: string) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });
  let assetId: string;
  try {
    assetId = assertSafeId(id, "mediaAssetId");
  } catch {
    return send(res, 400, { error: "invalid_id" });
  }
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, userId },
  });
  if (!asset) return send(res, 404, { error: "not_found" });
  const url = asset.s3Key ? await getSignedUrl(asset.s3Key).catch(() => null) : null;
  return send(res, 200, {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    url,
    createdAt: asset.createdAt.toISOString(),
  });
}

// Route matcher. Returns true if a media route matched and was handled.
export async function handleMediaRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!req.url) return false;
  const enqueueMatch = req.url.match(/^\/media\/(image|voice|video)\/?$/);
  if (enqueueMatch && req.method === "POST") {
    const kind = mediaKindSchema.parse(enqueueMatch[1]);
    await handleEnqueue(req, res, kind);
    return true;
  }
  const creationMatch = req.url.match(/^\/media\/character\/([A-Za-z0-9_-]{1,64})\/creation-images\/?$/);
  if (creationMatch && req.method === "POST") {
    await handleCreationImagesEnqueue(req, res, creationMatch[1]);
    return true;
  }
  const statusMatch = req.url.match(/^\/media\/([A-Za-z0-9_-]{1,64})\/?$/);
  if (statusMatch && req.method === "GET") {
    await handleStatus(req, res, statusMatch[1]);
    return true;
  }
  return false;
}
