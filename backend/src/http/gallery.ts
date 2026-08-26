// Gallery image unlock endpoint. Subscribed users spend 1 image token to
// permanently unlock a locked CharacterMedia row. Idempotent: a second call
// for the same (userId, characterMediaId) is a no-op with no token deducted.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { prisma } from "@buttercupp/database";
import { assertCanImage, recordImageConsumption, PaywallError, type PaywallInfo } from "../subscription/enforce";
import { logError } from "../utils/log";

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

async function authenticateReq(req: IncomingMessage): Promise<string | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["buttercupp_auth"];
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
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

const unlockBodySchema = z.object({
  characterMediaId: z.string().min(1).max(128),
});

export async function handleGalleryRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/gallery/unlock") return false;

  const userId = await authenticateReq(req);
  if (!userId) {
    send(res, 401, { error: "unauthorized" });
    return true;
  }

  let body: z.infer<typeof unlockBodySchema>;
  try {
    const raw = await readBody(req);
    body = unlockBodySchema.parse(raw);
  } catch {
    send(res, 400, { error: "invalid_body" });
    return true;
  }

  try {
    await assertCanImage(userId);
  } catch (err) {
    if (err instanceof PaywallError) {
      const payload = err.body as unknown as PaywallInfo;
      send(res, 402, payload);
      return true;
    }
    throw err;
  }

  try {
    // Try to create the unlock record. If it already exists the unique constraint
    // fires a P2002 error: the media was already unlocked, so skip token deduction
    // (idempotent). Only deduct a token on a fresh creation.
    let alreadyUnlocked = false;
    try {
      await prisma.userUnlockedMedia.create({
        data: { userId, characterMediaId: body.characterMediaId },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        alreadyUnlocked = true;
      } else {
        throw err;
      }
    }

    if (!alreadyUnlocked) {
      void recordImageConsumption(userId);
    }

    send(res, 200, { success: true });
  } catch (err) {
    logError("gallery", err, { userId, characterMediaId: body.characterMediaId });
    send(res, 500, { error: "unlock_failed" });
  }
  return true;
}
