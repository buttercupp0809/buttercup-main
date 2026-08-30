// Admin-only HTTP endpoints for LoRA training.
//
//   POST /admin/lora/train
//     Guards via x-admin-secret header matching ADMIN_SECRET env var.
//     Zod-validates the body, creates a CharacterLora row (status "pending")
//     via the Prisma singleton, then enqueues a train-lora job.
//     Returns { loraId, jobId, status }.
//     If Redis is absent the row is still created and { enqueueError } is
//     included in the response, mirroring how the media route degrades.
//
//   GET /admin/lora/:characterId
//     Returns all CharacterLora rows for the given character.
//
// Admin auth: shared-secret pattern. The only existing admin surface
// (/api/admin/seed-personas, frontend/app/api/admin/seed-personas/route.ts)
// also gates on a static secret. Here the secret travels in the
// x-admin-secret request header (more appropriate for a backend JSON API
// than a body field). Callers set ADMIN_SECRET in the backend .env.

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { prisma } from "@buttercupp/database";
import { enqueueTrainLoraJob } from "../queue/lora-queue";
import { logInfo, logError } from "../utils/log";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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

// Validates the x-admin-secret header against ADMIN_SECRET env var.
// Returns false if auth fails; the caller must send 403 and return.
function requireAdminSecret(req: IncomingMessage): boolean {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;
  const header = req.headers["x-admin-secret"];
  return header === adminSecret;
}

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

const trainBodySchema = z.object({
  characterId: z.string().min(1).max(64),
  characterVersionId: z.string().min(1).max(64).optional(),
  targetImageCount: z.number().int().min(15).max(80).optional(),
  baseModel: z.enum(["realvisxl_v5", "juggernaut_xl_v9"]).optional(),
});

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleTrain(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAdminSecret(req)) {
    return send(res, 403, { error: "forbidden" });
  }

  let body: z.infer<typeof trainBodySchema>;
  try {
    const raw = await readBody(req);
    body = trainBodySchema.parse(raw);
  } catch (e) {
    return send(res, 400, { error: "invalid_body", message: String(e) });
  }

  // Resolve characterVersionId: use the provided one, or fall back to the
  // character's currentVersionId so callers can omit it.
  const character = await prisma.character.findUnique({
    where: { id: body.characterId },
    select: { id: true, currentVersionId: true },
  });
  if (!character) {
    return send(res, 404, { error: "character_not_found" });
  }

  const characterVersionId = body.characterVersionId ?? character.currentVersionId ?? "";
  if (!characterVersionId) {
    return send(res, 409, { error: "no_current_version" });
  }

  // Create the CharacterLora row in "pending" state.
  const loraRow = await prisma.characterLora.create({
    data: {
      characterId: body.characterId,
      characterVersionId,
      status: "pending",
      ...(body.baseModel ? { baseModel: body.baseModel } : {}),
    },
  });

  logInfo("lora-admin", "CharacterLora row created", {
    loraId: loraRow.id,
    characterId: body.characterId,
    characterVersionId,
  });

  // Enqueue the training job. If Redis is absent we surface a clear error in
  // the response body instead of crashing (mirrors media route degradation).
  let jobId: string | null = null;
  let enqueueError: string | null = null;
  try {
    const result = await enqueueTrainLoraJob({
      source: "train-lora",
      characterId: body.characterId,
      characterVersionId,
      requestedBy: "admin",
      targetImageCount: body.targetImageCount ?? 30,
      baseModel: body.baseModel ?? "realvisxl_v5",
    });
    jobId = result.jobId;
  } catch (err) {
    enqueueError = err instanceof Error ? err.message : String(err);
    logError("lora-admin", err, { loraId: loraRow.id });
  }

  return send(res, 202, {
    loraId: loraRow.id,
    status: loraRow.status,
    ...(jobId !== null ? { jobId } : {}),
    ...(enqueueError !== null ? { enqueueError } : {}),
  });
}

async function handleStatus(
  req: IncomingMessage,
  res: ServerResponse,
  characterId: string,
): Promise<void> {
  if (!requireAdminSecret(req)) {
    return send(res, 403, { error: "forbidden" });
  }

  const rows = await prisma.characterLora.findMany({
    where: { characterId },
    orderBy: { createdAt: "desc" },
  });

  return send(res, 200, { rows });
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function handleLoraAdminRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!req.url) return false;

  if (req.method === "POST" && req.url === "/admin/lora/train") {
    await handleTrain(req, res);
    return true;
  }

  const statusMatch = req.url.match(/^\/admin\/lora\/([A-Za-z0-9_-]{1,64})\/?$/);
  if (statusMatch && req.method === "GET") {
    await handleStatus(req, res, statusMatch[1]);
    return true;
  }

  return false;
}
