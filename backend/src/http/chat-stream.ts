// HTTP SSE streaming endpoint for chat. This is the fallback path when the
// WebSocket handshake is blocked (corporate proxies, restrictive networks).
// The frontend proxies to it from /api/chat/stream so the browser sees a
// same-origin SSE connection.
//
// Contract:
//   POST /chat/stream
//     Headers: Cookie: buttercupp_auth=... (same JWT as the WS gateway)
//     Body: { conversationId: string, text: string }
//   Response: text/event-stream
//     Events: `token` (delta), `done` (messageId + provider), `safety`,
//             `error`.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { runChatTurn } from "../chat/engine";
import { assertCanChat, recordChatConsumption, PaywallError, type PaywallInfo } from "../subscription/enforce";
import { writeAuditLog } from "../utils/audit";
import { logInfo, logWarn, logError } from "../utils/log";

const bodySchema = z.object({
  conversationId: z.string().min(1).max(64),
  text: z.string().min(1).max(4000),
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

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// True if this request is a POST /chat/stream and we handled it.
export async function handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/chat/stream") return false;

  const userId = await authenticateReq(req);
  if (!userId) {
    logWarn("sse", "chat.stream rejected: unauthenticated");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }

  let body: { conversationId: string; text: string };
  try {
    body = bodySchema.parse(await readJsonBody(req));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_body", message: String(e) }));
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  logInfo("sse", `chat.stream conv=${body.conversationId}`, { userId });

  // Phase 21 paywall gate. Runs BEFORE runChatTurn so blocked users never
  // generate. Sending the 200 head first is deliberate: EventSource clients
  // then receive the `paywall` event through the normal frame reader
  // instead of a raw HTTP error status.
  try {
    await assertCanChat(userId);
  } catch (err) {
    if (err instanceof PaywallError) {
      const payload = err.body as unknown as PaywallInfo;
      sseWrite(res, "paywall", {
        conversationId: body.conversationId,
        ...payload,
      });
      writeAuditLog({
        userId,
        action: "chat.paywall_block",
        resource: `conversation:${body.conversationId}`,
      });
      res.end();
      return true;
    }
    throw err;
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const result = await runChatTurn({
      conversationId: body.conversationId,
      userId,
      userText: body.text,
      signal: controller.signal,
      onToken: (delta) => sseWrite(res, "token", { delta }),
      onSafety: (message, resources) => sseWrite(res, "safety", { message, resources }),
    });
    sseWrite(res, "done", {
      messageId: result.messageId,
      provider: result.provider,
      model: result.model,
    });
    if (result.consumedChat) {
      void recordChatConsumption(userId);
    }
  } catch (err) {
    logError("sse", err, { conversationId: body.conversationId });
    sseWrite(res, "error", {
      message: err instanceof Error ? err.message : "chat_failed",
    });
  } finally {
    res.end();
  }
  return true;
}
