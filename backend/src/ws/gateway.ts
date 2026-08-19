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
import { wsClientEventSchema, type WSClientEvent, type WSServerEvent } from "@buttercupp/shared";
import { runChatTurn } from "../chat/engine";
import { generateChatImage, generateImageTeaser } from "../chat/image-turn";
import { classifyMessageIntent } from "../chat/intent";
import { prisma } from "@buttercupp/database";
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
  // Cookie name matches frontend/lib/constants.ts BUTTERCUPP_AUTH_COOKIE.
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

function send(ws: WebSocket, event: WSServerEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(event));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

export function attachWsGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Keepalive. The ALB (and most proxies) silently drop a WebSocket after an
  // idle window (buttercupp's ALB is 300s). Without app-level pings a long
  // pause between messages kills the socket from the proxy's side; the next
  // server push (chat.done, media.ready) then hits a half-open connection and
  // is lost, leaving the client stuck on the typing indicator until a reload.
  // A 30s ping/pong keeps the connection warm and evicts genuinely dead
  // sockets (no pong since the last tick). Zero infra cost.
  const HEARTBEAT_MS = 30_000;
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      try {
        client.ping();
      } catch {
        // Socket already closing; the next tick's terminate() reaps it.
      }
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

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
    // Mark alive on connect and on every pong, so the heartbeat above only
    // reaps sockets that have gone silent for a full interval.
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    const sub = createWorkerConnection();
    if (sub) {
      // Not just fire-and-forget: if the client disconnects milliseconds
      // after connecting (a reload, a flaky mobile network, a test
      // navigation), this SUBSCRIBE can still be in flight when `sub.quit()`
      // runs in the "close" handler below, rejecting this promise with
      // "Connection is closed". `void` discards a promise's return value but
      // does NOT catch its rejection, so an uncaught rejection here used to
      // crash the entire backend process (confirmed locally: rapid WS
      // connect/disconnect during an E2E run reliably took the whole server
      // down). Every Redis command issued without an awaited try/catch needs
      // an explicit .catch, this one is no exception.
      sub.subscribe(userChannel(userId)).catch((err: Error) => {
        logWarn("ws", "redis subscribe failed (connection likely already closing)", {
          userId,
          err: err.message,
        });
      });
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

          // Image request: take the user's text as the prompt and generate an
          // image through Juggernaut (ComfyUI). Flow:
          //   1. Save user message to DB
          //   2. Get in-character teaser from Steno (streamed as tokens)
          //   3. Send chat.done with model="image-pending" to signal loading state
          //   4. Generate the image
          //   5. Save assistant image message to DB
          //   6. Send media.ready with the result
          if ((await classifyMessageIntent(parsed.text)) === "image") {
            logInfo("ws", `image request conv=${parsed.conversationId}`, { userId: session.userId });
            try {
              // 1. Save user message
              await prisma.message.create({
                data: {
                  conversationId: parsed.conversationId,
                  role: "user",
                  content: parsed.text,
                },
              });

              // 2. Look up character name for teaser
              const convRow = await prisma.conversation.findUnique({
                where: { id: parsed.conversationId },
                select: { character: { select: { name: true } } },
              });
              const characterName = convRow?.character?.name ?? "companion";

              // 3. Get in-character teaser from Steno and stream it as tokens
              const teaser = await generateImageTeaser(characterName, parsed.text);
              send(ws, { type: "chat.token", conversationId: parsed.conversationId, delta: teaser });

              // 4. Save teaser as assistant message
              const teaserMsg = await prisma.message.create({
                data: {
                  conversationId: parsed.conversationId,
                  role: "assistant",
                  content: teaser,
                },
              });

              // 5. Signal that an image is being generated (frontend shows skeleton)
              send(ws, {
                type: "chat.done",
                conversationId: parsed.conversationId,
                messageId: teaserMsg.id,
                provider: "stheno",
                model: "image-pending",
              });

              // 6. Generate the image
              const img = await generateChatImage(parsed.text, parsed.conversationId, session.userId);

              // 7. Save assistant image message so it persists across page reloads.
              //    Production: use MediaAsset ID as the message PK and link via
              //    mediaAssetId so the page can sign the S3 URL on reload.
              //    Local dev (no S3): store the data URL in content directly so
              //    the message still persists (it won't look great in DB but it
              //    works until S3 is wired up).
              const imgMsgId = img.mediaAssetId ?? `img-${Date.now()}`;
              if (img.mediaAssetId) {
                await prisma.message.create({
                  data: {
                    id: img.mediaAssetId,
                    conversationId: parsed.conversationId,
                    role: "assistant",
                    content: "",
                    mediaAssetId: img.mediaAssetId,
                  },
                });
              } else {
                await prisma.message.create({
                  data: {
                    id: imgMsgId,
                    conversationId: parsed.conversationId,
                    role: "assistant",
                    content: img.url,
                  },
                });
              }

              // 8. Update conversation timestamp
              await prisma.conversation.update({
                where: { id: parsed.conversationId },
                data: { lastMessageAt: new Date() },
              });

              // 9. Deliver image to the client
              send(ws, {
                type: "media.ready",
                conversationId: parsed.conversationId,
                mediaAssetId: imgMsgId,
                url: img.url,
                kind: "image",
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : "image_failed";
              logError("ws", err, { conversationId: parsed.conversationId, userId: session.userId });
              sendError(ws, "image_failed", msg);
            }
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
