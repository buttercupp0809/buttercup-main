// Telegram integration HTTP handler. Handles server-to-server webhook calls
// from Telegram (no auth, secret-token header) and frontend-facing routes for
// account linking, status checks, and disconnection (cookie JWT auth).
//
// Routes:
//   POST   /telegram/webhook/<characterId>  - Telegram webhook (no user auth)
//   POST   /telegram/link                   - generate deep link token (auth)
//   GET    /telegram/status/<characterId>   - check link status (auth)
//   DELETE /telegram/link/<characterId>     - disconnect (auth)

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { prisma } from "@buttercupp/database";
import { handleTelegramMessage } from "../telegram/chat";
import {
  consumeLinkToken,
  generateLinkToken,
  getTelegramLink,
  removeTelegramLink,
} from "../telegram/linker";
import { sendMessage } from "../telegram/client";
import { logWarn, logError } from "../utils/log";

// ---------------------------------------------------------------------------
// Auth helpers (mirrors gallery.ts exactly)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Body / response helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Route regexes
// ---------------------------------------------------------------------------

const WEBHOOK_RE = /^\/telegram\/webhook\/([a-zA-Z0-9_-]+)$/;
const STATUS_RE = /^\/telegram\/status\/([a-zA-Z0-9_-]+)$/;
const DISCONNECT_RE = /^\/telegram\/link\/([a-zA-Z0-9_-]+)$/;

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleTelegramRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "";

  // -------------------------------------------------------------------------
  // POST /telegram/webhook/<characterId>
  // Server-to-server: Telegram calls this. No user auth. Validated by
  // X-Telegram-Bot-Api-Secret-Token header matching bot.webhookSecret.
  // -------------------------------------------------------------------------
  const webhookMatch = url.match(WEBHOOK_RE);
  if (webhookMatch && method === "POST") {
    const characterId = webhookMatch[1]!;

    const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
    if (!bot) {
      send(res, 404, { error: "not_found" });
      return true;
    }

    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (secretHeader !== bot.webhookSecret) {
      logWarn("telegram", `webhook secret mismatch char=${characterId}`);
      send(res, 403, { error: "forbidden" });
      return true;
    }

    // Read body before responding so we don't miss bytes on fast connections.
    const update = await readBody(req);

    // Respond to Telegram immediately (it expects 200 within a few seconds).
    send(res, 200, { ok: true });

    // Process asynchronously so Telegram does not time out waiting for us.
    void (async () => {
      try {
        const message = update["message"] as Record<string, unknown> | undefined;
        if (!message) return;

        const from = message["from"] as Record<string, unknown> | undefined;
        const chat = message["chat"] as Record<string, unknown> | undefined;
        const text = message["text"] as string | undefined;

        // We need from, chat, and a text body. Voice/sticker/etc. are ignored.
        if (!from || !chat || typeof text !== "string") return;

        const telegramUserId = String(from["id"]);
        const telegramChatId = String(chat["id"]);
        const username = typeof from["username"] === "string" ? from["username"] : undefined;

        // /start <token>: account linking handshake sent by Telegram when user
        // taps the deep link from the app.
        if (text.startsWith("/start ")) {
          const token = text.slice(7).trim();
          const result = await consumeLinkToken(token, telegramUserId, telegramChatId, username);
          if (result.ok) {
            const char = await prisma.character.findUnique({
              where: { id: result.characterId },
              select: { name: true },
            });
            await sendMessage(
              bot.botToken,
              telegramChatId,
              `You're connected! You can now chat with ${char?.name ?? "your companion"} here on Telegram.`,
            );
          } else {
            const errorMsg =
              result.reason === "token_expired"
                ? "That link has expired. Please generate a new one from the app."
                : "Unable to link your account. Please try again from the app.";
            await sendMessage(bot.botToken, telegramChatId, errorMsg);
          }
          return;
        }

        // Regular message: look up the linked app user for this Telegram user
        // and character combination.
        const link = await prisma.telegramUserLink.findUnique({
          where: {
            telegramUserId_characterId: { telegramUserId, characterId },
          },
        });
        if (!link) {
          await sendMessage(
            bot.botToken,
            telegramChatId,
            "Please link your account first by opening the app and clicking Connect on Telegram.",
          );
          return;
        }

        await handleTelegramMessage({
          botToken: bot.botToken,
          telegramChatId,
          telegramUserId,
          userId: link.userId,
          characterId,
          text,
        });
      } catch (err) {
        logError("telegram", err, { characterId });
      }
    })();

    return true;
  }

  // -------------------------------------------------------------------------
  // POST /telegram/link - generate deep link (requires user auth)
  // -------------------------------------------------------------------------
  if (url === "/telegram/link" && method === "POST") {
    const userId = await authenticateReq(req);
    if (!userId) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }

    const body = await readBody(req);
    const characterId = body["characterId"];
    if (typeof characterId !== "string" || !characterId) {
      send(res, 400, { error: "characterId required" });
      return true;
    }

    try {
      const result = await generateLinkToken(userId, characterId);
      send(res, 200, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      const status = msg === "no_bot_configured_for_character" ? 404 : 500;
      send(res, status, { error: msg });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // GET /telegram/status/<characterId> - check link status (requires auth)
  // -------------------------------------------------------------------------
  const statusMatch = url.match(STATUS_RE);
  if (statusMatch && method === "GET") {
    const userId = await authenticateReq(req);
    if (!userId) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }

    const characterId = statusMatch[1]!;
    const link = await getTelegramLink(userId, characterId);
    send(res, 200, {
      linked: link !== null,
      username: link?.username ?? null,
      linkedAt: link?.linkedAt ?? null,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // DELETE /telegram/link/<characterId> - disconnect (requires auth)
  // -------------------------------------------------------------------------
  const disconnectMatch = url.match(DISCONNECT_RE);
  if (disconnectMatch && method === "DELETE") {
    const userId = await authenticateReq(req);
    if (!userId) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }

    const characterId = disconnectMatch[1]!;
    await removeTelegramLink(userId, characterId);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}
