// CTA click tracking endpoint. Records which upgrade/payment button a user
// clicked, from where, so conversion funnels can be analyzed without
// instrumenting the frontend with a third-party analytics SDK.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { track } from "../analytics/tracker";

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

const ctaBodySchema = z.object({
  buttonId: z.string().min(1).max(128),
  area: z.string().min(1).max(128),
  path: z.string().min(1).max(512),
});

export async function handleAnalyticsRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/analytics/cta") return false;

  const userId = await authenticateReq(req);
  if (!userId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }

  let body: z.infer<typeof ctaBodySchema>;
  try {
    const raw = await readBody(req);
    body = ctaBodySchema.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_body" }));
    return true;
  }

  track("cta_click", { buttonId: body.buttonId, area: body.area, path: body.path }, userId);

  res.writeHead(204);
  res.end();
  return true;
}
