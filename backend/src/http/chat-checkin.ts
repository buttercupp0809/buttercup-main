// POST /chat/checkin
//   Headers: Cookie: buttercupp_auth=... (same JWT as chat-stream)
//   Body: { conversationId: string }
//   Response: 200 { created: boolean, message?: { id, role, content, createdAt } }
//             400 invalid body
//             401 missing / invalid auth
//
// Never 500 on a generation failure: maybeRunCheckin swallows LLM errors and
// falls back to the character's static greeting. This route only 500s on an
// unexpected DB failure, and even then the frontend caller swallows the error
// (best effort), so the chat page still opens.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { maybeRunCheckin } from "../chat/checkin";
import { logInfo, logWarn, logError } from "../utils/log";

const bodySchema = z.object({
  conversationId: z.string().min(1).max(64),
});

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

function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

export async function handleChatCheckin(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/chat/checkin") return false;

  const userId = await authenticateReq(req);
  if (!userId) {
    logWarn("http", "chat.checkin rejected: unauthenticated");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }

  let body: { conversationId: string };
  try {
    body = bodySchema.parse(await readJsonBody(req));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_body", message: String(e) }));
    return true;
  }

  try {
    const result = await maybeRunCheckin({ conversationId: body.conversationId, userId });
    logInfo("http", `chat.checkin conv=${body.conversationId} created=${result.created}`, { userId });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    logError("http", err, { route: "chat.checkin", conversationId: body.conversationId });
    // Never surface generation failures. Fall back to "no check-in created"
    // so the frontend renders whatever history already exists.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ created: false }));
  }
  return true;
}
