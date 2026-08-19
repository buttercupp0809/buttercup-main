// POST /chat/checkin/stream
//   Headers: Cookie: buttercupp_auth=... (same JWT as chat-stream)
//   Body: { conversationId: string }
//   Response: text/event-stream
//
// Live-streamed version of POST /chat/checkin. Instead of generating the whole
// check-in with a blocking callLLM and returning JSON, this streams the
// check-in token-by-token as the user enters the chat, using the SAME SSE frame
// format as POST /chat/stream so the frontend's existing SSE parser
// (frontend/lib/chat-transport.ts) reads it unchanged.
//
// Events emitted:
//   event: token   data: { "delta": string }              (per token)
//   event: done    data: { messageId, provider, model }   (terminal, on persist)
//   event: skip    data: {}                                (terminal, ineligible)
//   event: error   data: { message }                       (terminal, on failure)
//
// Eligibility is decided at request time (resolveCheckinPlan). Because the
// persisted assistant message makes first_open false, a refresh re-runs the
// check and hits the `skip` path, so this is idempotent.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import {
  resolveCheckinPlan,
  checkinFallbackContent,
  persistCheckinMessage,
} from "../chat/checkin";
import { streamLLM } from "../llm/provider";
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

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// True if this request is a POST /chat/checkin/stream and we handled it.
export async function handleChatCheckinStream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/chat/checkin/stream") return false;

  const userId = await authenticateReq(req);
  if (!userId) {
    logWarn("sse", "chat.checkin.stream rejected: unauthenticated");
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

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  logInfo("sse", `chat.checkin.stream conv=${body.conversationId}`, { userId });

  try {
    const plan = await resolveCheckinPlan(body.conversationId, userId);
    if (!plan.eligible) {
      sseWrite(res, "skip", {});
      res.end();
      return true;
    }

    // Stream generation live, forwarding each token. Assemble the text so we can
    // persist it verbatim on completion.
    let assembled = "";
    const result = await streamLLM(
      {
        purpose: "chat",
        systemPrompt: plan.systemPrompt,
        messages: [{ role: "user", content: plan.userMessage }],
        maxTokens: 120,
        temperature: 0.8,
        contentRating: plan.contentRating,
        tier: plan.tier,
        jurisdiction: plan.jurisdiction,
      },
      (delta) => {
        assembled += delta;
        sseWrite(res, "token", { delta });
      },
    );

    // A whole-chain outage returns the hardcoded fallback string streamed as a
    // single token. Treat that (and any empty generation) as "no content" and
    // fall back to the character's static greeting, matching maybeRunCheckin.
    let content = assembled.trim();
    if (result.provider === "hardcoded") content = "";
    if (!content) {
      content = checkinFallbackContent(plan);
      // The streamed tokens (if any) were the unusable hardcoded line; emit the
      // fallback so the client's assembled text ends up correct.
      sseWrite(res, "token", { delta: content });
    }

    const persisted = await persistCheckinMessage(body.conversationId, content);
    if (!persisted) {
      // Lost an idempotency race (concurrent open persisted first). Nothing to
      // deliver; treat as skip so the client keeps existing history.
      sseWrite(res, "skip", {});
      res.end();
      return true;
    }

    logInfo("checkin", `streamed check-in conv=${body.conversationId} msg=${persisted.id}`);
    sseWrite(res, "done", {
      messageId: persisted.id,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    logError("sse", err, { route: "chat.checkin.stream", conversationId: body.conversationId });
    sseWrite(res, "error", {
      message: err instanceof Error ? err.message : "checkin_failed",
    });
  } finally {
    res.end();
  }
  return true;
}
