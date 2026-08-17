// Backend HTTP surface for billing checkout + webhooks. In production,
// webhook URLs point directly at these backend routes (processors call
// server-to-server; they don't need to go through Next.js). The frontend
// billing UI proxies POST /billing/subscribe and /billing/tokens.

import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { createCheckoutSession, resetProviderHealth } from "../payments/provider";
import { processSubscriptionEvent, TOKEN_PACKS } from "../payments/webhooks/shared";
import * as ccbillHook from "../payments/webhooks/ccbill";
import * as verotelHook from "../payments/webhooks/verotel";
import * as segpayHook from "../payments/webhooks/segpay";
import * as cryptoHook from "../payments/webhooks/crypto";
import * as dodoHook from "../payments/webhooks/dodo";
import { ccbillWebhookSchema } from "../payments/webhooks/ccbill";
import { verotelWebhookSchema } from "../payments/webhooks/verotel";
import { segpayWebhookSchema } from "../payments/webhooks/segpay";
import { cryptoWebhookSchema } from "../payments/webhooks/crypto";
import type { NormalizedEvent, PaymentProvider } from "../payments/types";
import { writeAuditLog } from "../utils/audit";
import { normalizeTier } from "../subscription/tier";
import { entitlementsFor } from "../subscription/entitlements";
import { PLANS, PLANS_ORDER, isPlan } from "../subscription/plans";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<{ raw: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += String(c)));
    req.on("end", () => {
      try {
        resolve({ raw: buf, json: buf ? JSON.parse(buf) : {} });
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
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

// Absolute-URL defaults for hosted-checkout providers (Dodo requires absolute
// URLs and returns HTTP 400 on relative paths). We prefer the request's
// Origin (browser-supplied), then FRONTEND_URL from env, then the first
// entry of CORS_ALLOWED_ORIGINS, then localhost:3000 as the local fallback.
function frontendOrigin(req: IncomingMessage): string {
  const originHeader = req.headers.origin;
  if (typeof originHeader === "string" && /^https?:\/\//.test(originHeader)) return originHeader;
  const envUrl = process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && /^https?:\/\//.test(envUrl)) return envUrl.replace(/\/$/, "");
  const cors = process.env.CORS_ALLOWED_ORIGINS?.split(",")[0]?.trim();
  if (cors && /^https?:\/\//.test(cors)) return cors;
  return "http://localhost:3000";
}

function defaultUrls(req: IncomingMessage, body: { successUrl?: string; cancelUrl?: string }): {
  successUrl: string; cancelUrl: string;
} {
  const origin = frontendOrigin(req);
  const abs = (u: string | undefined, path: string): string =>
    u && /^https?:\/\//.test(u) ? u : `${origin}${u && u.startsWith("/") ? u : path}`;
  return {
    successUrl: abs(body.successUrl, "/billing?success=1"),
    cancelUrl: abs(body.cancelUrl, "/billing?cancel=1"),
  };
}

async function handleSubscribe(req: IncomingMessage, res: ServerResponse) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });
  const { json } = await readBody(req);
  const body = json as { plan?: string; tier?: string; successUrl?: string; cancelUrl?: string };
  const urls = defaultUrls(req, body);

  // Phase 20 preferred path: `{ plan: "daily" | "weekly" | "monthly" }`.
  // Falls through to the legacy tier body if `plan` is absent, so pre-Phase-20
  // clients keep working.
  if (isPlan(body.plan) && body.plan !== "free") {
    try {
      const resp = await createCheckoutSession({
        userId,
        intent: "subscription",
        plan: body.plan,
        successUrl: urls.successUrl,
        cancelUrl: urls.cancelUrl,
      });
      return send(res, 200, resp);
    } catch (err) {
      return send(res, 503, { error: "no_provider", message: (err as Error).message });
    }
  }

  const tier = normalizeTier(body.tier);
  if (tier === "free") return send(res, 400, { error: "invalid_plan_or_tier" });
  try {
    const resp = await createCheckoutSession({
      userId,
      intent: "subscription",
      tier,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    return send(res, 200, resp);
  } catch (err) {
    return send(res, 503, { error: "no_provider", message: (err as Error).message });
  }
}

async function handleEntitlements(req: IncomingMessage, res: ServerResponse) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });
  const ent = await entitlementsFor(userId);
  return send(res, 200, ent);
}

async function handleListPlans(_req: IncomingMessage, res: ServerResponse) {
  // Public: the plan catalog is not secret. Return in canonical order so
  // the UI does not have to sort.
  const items = PLANS_ORDER.map((k) => PLANS[k]);
  return send(res, 200, { plans: items });
}

async function handleTokenPacks(_req: IncomingMessage, res: ServerResponse) {
  // Public: the token pack catalog is not secret. The UI reads this instead
  // of hardcoding credits/price so TOKEN_PACKS in webhooks/shared.ts stays
  // the single source of truth.
  const items = Object.entries(TOKEN_PACKS).map(([id, pack]) => ({ id, ...pack }));
  return send(res, 200, { packs: items });
}

async function handleBuyTokens(req: IncomingMessage, res: ServerResponse) {
  const userId = await authenticate(req);
  if (!userId) return send(res, 401, { error: "unauthorized" });
  const { json } = await readBody(req);
  const body = json as { packId?: string; successUrl?: string; cancelUrl?: string };
  if (!body.packId || !TOKEN_PACKS[body.packId]) return send(res, 400, { error: "invalid_pack" });
  const urls = defaultUrls(req, body);
  try {
    const resp = await createCheckoutSession({
      userId,
      intent: "tokens",
      tokenPackId: body.packId,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    return send(res, 200, resp);
  } catch (err) {
    return send(res, 503, { error: "no_provider", message: (err as Error).message });
  }
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  provider: PaymentProvider,
) {
  const { raw, json } = await readBody(req);
  let event: NormalizedEvent | null;
  try {
    if (provider === "ccbill") {
      const parsed = ccbillWebhookSchema.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: "bad_body" });
      if (!ccbillHook.verifySignature(parsed.data)) return send(res, 401, { error: "bad_signature" });
      event = ccbillHook.normalize(parsed.data);
    } else if (provider === "verotel") {
      const parsed = verotelWebhookSchema.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: "bad_body" });
      if (!verotelHook.verifySignature(parsed.data)) return send(res, 401, { error: "bad_signature" });
      event = verotelHook.normalize(parsed.data);
    } else if (provider === "segpay") {
      const parsed = segpayWebhookSchema.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: "bad_body" });
      const sig = req.headers["x-segpay-signature"] as string | undefined;
      if (!segpayHook.verifySignature(raw, sig)) return send(res, 401, { error: "bad_signature" });
      event = segpayHook.normalize(parsed.data);
    } else if (provider === "crypto") {
      const parsed = cryptoWebhookSchema.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: "bad_body" });
      const sig = req.headers["x-cc-webhook-signature"] as string | undefined;
      if (!cryptoHook.verifySignature(raw, sig)) return send(res, 401, { error: "bad_signature" });
      event = cryptoHook.normalize(parsed.data);
    } else if (provider === "dodo") {
      // Standard-Webhooks verification requires the EXACT raw bytes plus the
      // three `webhook-*` headers. Any pre-parsing (JSON.parse etc.) would
      // corrupt the signature check, so we hand the raw string to the SDK.
      const headers: Record<string, string> = {};
      for (const k of ["webhook-id", "webhook-signature", "webhook-timestamp"]) {
        const v = req.headers[k];
        if (typeof v === "string") headers[k] = v;
      }
      let unwrapped;
      try {
        unwrapped = dodoHook.verifyAndParse(raw, headers);
      } catch {
        writeAuditLog({ action: "webhook.signature_failed", resource: "dodo" });
        return send(res, 400, { error: "bad_signature" });
      }
      event = dodoHook.normalize(unwrapped);
    } else {
      return send(res, 400, { error: "unsupported_provider" });
    }
  } catch {
    return send(res, 400, { error: "bad_body" });
  }
  if (!event) return send(res, 200, { applied: false, effect: "unmapped_event" });
  const result = await processSubscriptionEvent(event);
  return send(res, 200, result);
}

export async function handleBillingRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!req.url) return false;
  if (req.method === "POST" && req.url === "/billing/subscribe") {
    await handleSubscribe(req, res);
    return true;
  }
  if (req.method === "POST" && req.url === "/billing/tokens") {
    await handleBuyTokens(req, res);
    return true;
  }
  if (req.method === "GET" && req.url === "/billing/entitlements") {
    await handleEntitlements(req, res);
    return true;
  }
  if (req.method === "GET" && req.url === "/billing/plans") {
    await handleListPlans(req, res);
    return true;
  }
  if (req.method === "GET" && req.url === "/billing/token-packs") {
    await handleTokenPacks(req, res);
    return true;
  }
  const webhookMatch = req.url.match(/^\/webhooks\/(ccbill|verotel|segpay|crypto|dodo)\/?$/);
  if (webhookMatch && req.method === "POST") {
    await handleWebhook(req, res, webhookMatch[1] as PaymentProvider);
    return true;
  }
  if (req.url === "/billing/reset-provider-health" && req.method === "POST") {
    resetProviderHealth();
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}
