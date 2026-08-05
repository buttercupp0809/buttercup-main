// WebSocket gateway. Runs alongside the HTTP server on the backend
// container (ECS/ALB-ready). Authenticates the handshake with the same
// cookie JWT that the frontend uses (jose), then dispatches per-message
// events from PRD §9.2.
//
// Rate limiting is per-user in-memory here for local dev. Phase 12 swaps it
// for Redis for horizontal scaling.

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { jwtVerify } from "jose";
import { wsClientEventSchema, type WSClientEvent, type WSServerEvent } from "@poppy/shared";
import { runChatTurn } from "../chat/engine";
import { assertCanChat, recordChatConsumption, PaywallError, type PaywallInfo } from "../subscription/enforce";
import { writeAuditLog } from "../utils/audit";
import { createWorkerConnection } from "../queue/connection";
import { userChannel, type WsBridgeMessage } from "../queue/ws-notify";
import { logInfo, logWarn, logError } from "../utils/log";

interface Session {
  userId: string;
  // AbortControllers for in-flight chat turns per conversation, so
  // chat.cancel can abort them cleanly.
  inflight: Map<string, AbortController>;
  // Simple token-bucket rate limiter per user session (Phase 12: swap for
  // Redis). 20 messages / 60s.
  bucket: { tokens: number; refilledAt: number };
}

function newSession(userId: string): Session {
  return {
    userId,
    inflight: new Map(),
    bucket: { tokens: 20, refilledAt: Date.now() },
  };
}

function takeToken(session: Session): boolean {
  const now = Date.now();
  const elapsed = now - session.bucket.refilledAt;
  if (elapsed >= 60_000) {
    session.bucket.tokens = 20;
    session.bucket.refilledAt = now;
  }
  if (session.bucket.tokens <= 0) return false;
  session.bucket.tokens -= 1;
  return true;
}

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
  const cookies = parseCookies(req.headers.cookie);
  // Cookie name matches frontend/lib/constants.ts POPPY_AUTH_COOKIE.
  const token = cookies["poppy_auth"];
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      audience: "poppy:auth",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function send(ws: WebSocket, event: WSServerEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(event));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

export function attachWsGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const userId = await authenticate(req);
    if (!userId) {
      logWarn("ws", "upgrade rejected: unauthenticated");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, userId);
    });
  });

  // Per-user Redis subscriber for cross-process WS bridge messages (worker
  // -> gateway). Each connection sets one up; on close we quit the client.
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    const session = newSession(userId);
    logInfo("ws", "connected", { userId });
    const sub = createWorkerConnection();
    if (sub) {
      void sub.subscribe(userChannel(userId));
      sub.on("message", (_ch: string, raw: string) => {
        let msg: WsBridgeMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.type === "media.ready") {
          send(ws, {
            type: "media.ready",
            conversationId: msg.payload.conversationId ?? "",
            mediaAssetId: msg.payload.mediaAssetId,
            url: msg.payload.url,
            kind: msg.payload.kind,
          });
        } else if (msg.type === "media.error") {
          sendError(ws, "media_failed", msg.payload.message);
        }
      });
    }

    ws.on("message", async (raw) => {
      let parsed: WSClientEvent;
      try {
        parsed = wsClientEventSchema.parse(JSON.parse(String(raw)));
      } catch {
        sendError(ws, "bad_frame", "invalid or unknown event");
        return;
      }

      switch (parsed.type) {
        case "chat.send": {
          logInfo("ws", `chat.send conv=${parsed.conversationId}`, { userId: session.userId });
          if (!takeToken(session)) {
            logWarn("ws", `rate_limited conv=${parsed.conversationId}`, { userId: session.userId });
            sendError(ws, "rate_limited", "slow down and try again in a moment");
            writeAuditLog({
              userId: session.userId,
              action: "chat.rate_limited",
              resource: `conversation:${parsed.conversationId}`,
            });
            return;
          }
          // Phase 21 paywall gate. Runs BEFORE any engine work so a
          // blocked user never generates and never consumes anything.
          try {
            await assertCanChat(session.userId);
          } catch (err) {
            if (err instanceof PaywallError) {
              const body = err.body as unknown as PaywallInfo;
              send(ws, {
                type: "paywall",
                conversationId: parsed.conversationId,
                reason: body.reason,
                scope: body.scope,
                kind: body.kind,
                used: body.used,
                limit: body.limit,
                plans: body.plans,
                upgradeUrl: body.upgradeUrl,
              });
              writeAuditLog({
                userId: session.userId,
                action: "chat.paywall_block",
                resource: `conversation:${parsed.conversationId}`,
              });
              return;
            }
            throw err;
          }

          const controller = new AbortController();
          session.inflight.set(parsed.conversationId, controller);
          try {
            const result = await runChatTurn({
              conversationId: parsed.conversationId,
              userId: session.userId,
              userText: parsed.text,
              signal: controller.signal,
              onToken: (delta) =>
                send(ws, {
                  type: "chat.token",
                  conversationId: parsed.conversationId,
                  delta,
                }),
              onSafety: (message, resources) => {
                send(ws, {
                  type: "safety.intervention",
                  conversationId: parsed.conversationId,
                  message,
                  resources,
                });
                writeAuditLog({
                  userId: session.userId,
                  action: "chat.safety_intervention",
                  resource: `conversation:${parsed.conversationId}`,
                });
              },
            });
            send(ws, {
              type: "chat.done",
              conversationId: parsed.conversationId,
              messageId: result.messageId,
              provider: result.provider,
              model: result.model,
            });
            // Consume AFTER a successful reply so failed/aborted streams
            // never cost the user a chat. Crisis interventions set
            // `consumedChat=false` so they are free.
            if (result.consumedChat) {
              void recordChatConsumption(session.userId);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown";
            logError("ws", err, { conversationId: parsed.conversationId, userId: session.userId });
            sendError(ws, "chat_failed", msg);
          } finally {
            session.inflight.delete(parsed.conversationId);
          }
          break;
        }
        case "chat.cancel": {
          const ctrl = session.inflight.get(parsed.conversationId);
          if (ctrl) ctrl.abort();
          break;
        }
        case "typing.start":
        case "typing.stop": {
          send(ws, {
            type: "typing.indicator",
            conversationId: parsed.conversationId,
            who: "user",
            active: parsed.type === "typing.start",
          });
          break;
        }
        case "media.request": {
          // Wired in Phase 08/09. Reply with a not-yet-implemented error
          // frame so the client shows a friendly message instead of hanging.
          sendError(ws, "not_implemented", "media generation lands in Phase 08/09");
          break;
        }
      }
    });

    ws.on("close", () => {
      logInfo("ws", "disconnected", { userId });
      for (const c of session.inflight.values()) c.abort();
      session.inflight.clear();
      sub?.quit().catch(() => null);
    });
  });

  return wss;
}
