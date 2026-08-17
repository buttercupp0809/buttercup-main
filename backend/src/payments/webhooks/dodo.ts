// Dodo Payments webhook: verify (Standard Webhooks via SDK) + normalize.
// The signing check runs on the RAW body BEFORE any DB write. Metadata is
// what we trust to identify the user + intent (set at checkout in
// ../dodo.ts).

import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks";
import type { NormalizedEvent, NormalizedEventType } from "../types";
import { isPlan, type Plan } from "../../subscription/plans";
import { getClient } from "../dodo";

// Verify + parse a Dodo delivery using the SDK's Standard Webhooks impl.
// Throws on invalid signature (caller returns 400). The SDK expects lowercase
// `webhook-id` / `webhook-signature` / `webhook-timestamp` headers.
export function verifyAndParse(
  rawBody: string,
  headers: Record<string, string>,
): UnwrapWebhookEvent {
  const c = getClient();
  if (!c) throw new Error("dodo_not_configured");
  return c.webhooks.unwrap(rawBody, { headers });
}

// Dodo's native event.type strings, mapped to the shared normalized type. For
// one-time PASS purchases, `payment.succeeded` still means "activate the plan"
// (we distinguish via metadata.intent below, not by product-id lookup).
const EVENT_MAP: Record<string, NormalizedEventType> = {
  "subscription.active": "subscription.activated",
  "subscription.renewed": "subscription.activated",
  "subscription.updated": "subscription.updated",
  "subscription.plan_changed": "subscription.updated",
  "subscription.cancelled": "subscription.canceled",
  "subscription.expired": "subscription.canceled",
  "subscription.on_hold": "subscription.past_due",
  "subscription.failed": "subscription.past_due",
  "payment.succeeded": "transaction.completed",
  "payment.failed": "payment_failed",
};

interface UnwrappedLike {
  type: string;
  business_id?: string;
  timestamp?: string;
  data?: {
    metadata?: Record<string, string> | null;
    payment_id?: string;
    subscription_id?: string;
    total_amount?: number;
    currency?: string;
  } | null;
}

export function normalize(event: UnwrapWebhookEvent): NormalizedEvent | null {
  const evt = event as unknown as UnwrappedLike;
  const mapped = EVENT_MAP[evt.type];
  const md = evt.data?.metadata ?? {};
  const userId = md.userId;
  if (!mapped || !userId) return null;

  const intent = md.intent;
  const tokenPackId = md.tokenPackId && md.tokenPackId !== "" ? md.tokenPackId : undefined;
  const rawPlan = md.plan && md.plan !== "" ? md.plan : undefined;
  const plan: Plan | undefined = isPlan(rawPlan) ? rawPlan : undefined;

  // ButterCupp's PASS purchases arrive as `payment.succeeded` with
  // intent!="tokens" (one-time products). Rewrite the eventType so the
  // shared pipeline treats it like subscription.activated + plan.
  const isTokens = intent === "tokens" && Boolean(tokenPackId);
  let eventType: NormalizedEventType = mapped;
  if (mapped === "transaction.completed" && !isTokens) {
    eventType = "subscription.activated";
  }

  const eventId =
    evt.data?.payment_id ??
    evt.data?.subscription_id ??
    `${evt.type}:${evt.business_id ?? ""}:${evt.timestamp ?? ""}`;

  return {
    provider: "dodo",
    eventId,
    eventType,
    userId,
    plan: eventType === "subscription.activated" ? plan : undefined,
    tokenPackId: isTokens ? tokenPackId : undefined,
    externalSubscriptionId: evt.data?.subscription_id,
    amount: typeof evt.data?.total_amount === "number" ? evt.data.total_amount : undefined,
    currency: evt.data?.currency,
    raw: event as unknown as Record<string, unknown>,
  };
}
