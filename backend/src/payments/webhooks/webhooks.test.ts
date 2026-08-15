// Webhook integration test. Uses the live buttercupp_dev DB so recordEvent
// exercises the real unique-index dedupe. Signature-verification unit
// tests live alongside each provider file to stay in the same commit as
// any signing change.

import { describe, expect, it } from "vitest";
import { prisma } from "@buttercupp/database";
import { processSubscriptionEvent } from "./shared";
import type { NormalizedEvent } from "../types";
import { verifySignature as verifyCcbill, ccbillWebhookSchema } from "./ccbill";
import { verifySignature as verifyVerotel, verotelWebhookSchema } from "./verotel";
import { verifySignature as verifySegpay, segpayWebhookSchema } from "./segpay";
import { verifySignature as verifyCrypto, normalize as normalizeCrypto, cryptoWebhookSchema } from "./crypto";
import crypto from "node:crypto";
import { dbReachable } from "../../test-utils/db";

const DB_UP = await dbReachable();

async function makeUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `hook-${crypto.randomUUID()}@test.local`, tokenBalance: 0 },
  });
  return u.id;
}

describe.skipIf(!DB_UP)("processSubscriptionEvent", () => {
  it("activates a premium subscription and grants monthly tokens once", async () => {
    const userId = await makeUser();
    const ev: NormalizedEvent = {
      provider: "ccbill",
      eventId: `test-${crypto.randomUUID()}`,
      eventType: "subscription.activated",
      userId,
      tier: "premium",
      raw: {},
    };
    const first = await processSubscriptionEvent(ev);
    expect(first.applied).toBe(true);
    expect(first.effect).toBe("tier_activated");
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.subscriptionTier).toBe("premium");
    expect(u?.tokenBalance).toBe(500);

    // Same event id: no-op.
    const dup = await processSubscriptionEvent(ev);
    expect(dup.applied).toBe(false);
    expect(dup.effect).toBe("duplicate");
    const u2 = await prisma.user.findUnique({ where: { id: userId } });
    expect(u2?.tokenBalance).toBe(500);
  });

  it("plan: monthly activation sets Subscription.plan and expiry ~= now + 30d", async () => {
    const userId = await makeUser();
    const before = Date.now();
    const r = await processSubscriptionEvent({
      provider: "ccbill",
      eventId: `plan-${crypto.randomUUID()}`,
      eventType: "subscription.activated",
      userId,
      plan: "monthly",
      raw: {},
    });
    expect(r.applied).toBe(true);
    expect(r.effect).toBe("plan_activated");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.plan).toBe("monthly");
    expect(sub?.currentPeriodEnd).not.toBeNull();
    const deltaMs = sub!.currentPeriodEnd!.getTime() - before;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    // Allow +/- 10 seconds for test scheduling jitter.
    expect(deltaMs).toBeGreaterThan(thirtyDays - 10_000);
    expect(deltaMs).toBeLessThan(thirtyDays + 10_000);
  });

  it("token-pack transaction.completed still grants credits without touching plan", async () => {
    const userId = await makeUser();
    // Activate a plan so we can prove the pack path does NOT overwrite it.
    await processSubscriptionEvent({
      provider: "ccbill",
      eventId: `act-plan-${crypto.randomUUID()}`,
      eventType: "subscription.activated",
      userId,
      plan: "daily",
      raw: {},
    });
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const r = await processSubscriptionEvent({
      provider: "ccbill",
      eventId: `pack-${crypto.randomUUID()}`,
      eventType: "transaction.completed",
      userId,
      tokenPackId: "pack_100",
      raw: {},
    });
    expect(r.effect).toBe("tokens_granted");
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.tokenBalance).toBe((before?.tokenBalance ?? 0) + 100);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.plan).toBe("daily");
  });

  it("downgrades on cancellation", async () => {
    const userId = await makeUser();
    await processSubscriptionEvent({
      provider: "ccbill",
      eventId: `act-${crypto.randomUUID()}`,
      eventType: "subscription.activated",
      userId,
      tier: "premium",
      raw: {},
    });
    const r = await processSubscriptionEvent({
      provider: "ccbill",
      eventId: `cancel-${crypto.randomUUID()}`,
      eventType: "subscription.canceled",
      userId,
      raw: {},
    });
    expect(r.effect).toBe("downgraded_to_free");
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.subscriptionTier).toBe("free");
  });
});

describe("CCBill signature verification", () => {
  it("rejects a tampered digest", () => {
    process.env.CCBILL_DATALINK_SALT = "test-salt";
    const payload = {
      eventType: "NewSaleSuccess",
      subscriptionId: "sub_1",
      timestamp: "1700000000",
      digest: "not-a-real-digest",
    };
    expect(verifyCcbill(payload as never)).toBe(false);
  });
  it("accepts a valid digest", () => {
    process.env.CCBILL_DATALINK_SALT = "test-salt";
    const subscriptionId = "sub_1";
    const timestamp = "1700000000";
    const digest = crypto
      .createHash("md5")
      .update(`${subscriptionId}${timestamp}test-salt`)
      .digest("hex");
    expect(
      verifyCcbill({ eventType: "NewSaleSuccess", subscriptionId, timestamp, digest } as never),
    ).toBe(true);
  });
});

describe("Verotel signature verification", () => {
  it("rejects a tampered signature", () => {
    process.env.VEROTEL_SIGNATURE_KEY = "verotel-key";
    expect(
      verifyVerotel({ type: "approved", userId: "u1", saleID: "s1", signature: "not-a-real-signature" }),
    ).toBe(false);
  });

  it("accepts a valid signature computed over sorted fields", () => {
    process.env.VEROTEL_SIGNATURE_KEY = "verotel-key";
    const payload: Record<string, string> = { type: "approved", userId: "u1", saleID: "s1" };
    const entries = Object.entries(payload).sort(([a], [b]) => a.localeCompare(b));
    const canonical = entries.map(([k, v]) => `${k}=${v}`).join(":");
    const signature = crypto.createHash("sha256").update(`verotel-key:${canonical}`).digest("hex");
    expect(verifyVerotel({ ...payload, signature })).toBe(true);
  });
});

describe("SegPay signature verification", () => {
  it("rejects a tampered signature", () => {
    process.env.SEGPAY_HMAC_KEY = "segpay-key";
    expect(verifySegpay('{"eventType":"auth"}', "not-a-real-signature")).toBe(false);
  });

  it("accepts a valid HMAC-SHA1 signature over the raw body", () => {
    process.env.SEGPAY_HMAC_KEY = "segpay-key";
    const raw = '{"eventType":"auth","userId":"u1"}';
    const signature = crypto.createHmac("sha1", "segpay-key").update(raw).digest("hex");
    expect(verifySegpay(raw, signature)).toBe(true);
  });
});

describe("crypto (Coinbase Commerce) webhook", () => {
  it("verifySignature returns false when the shared secret is unset", () => {
    delete process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
    expect(verifyCrypto("{}", "anything")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    process.env.COINBASE_COMMERCE_WEBHOOK_SECRET = "cc-secret";
    expect(verifyCrypto('{"event":{"type":"charge:confirmed"}}', "not-a-real-signature")).toBe(false);
  });

  it("accepts a valid HMAC-SHA256 signature over the raw body", () => {
    process.env.COINBASE_COMMERCE_WEBHOOK_SECRET = "cc-secret";
    const raw = JSON.stringify({ event: { type: "charge:confirmed" } });
    const signature = crypto.createHmac("sha256", "cc-secret").update(raw).digest("hex");
    expect(verifyCrypto(raw, signature)).toBe(true);
  });

  it("normalizes charge:confirmed / charge:resolved to transaction.completed, never to subscription.activated", () => {
    const payload = cryptoWebhookSchema.parse({
      event: {
        id: "evt_1",
        type: "charge:confirmed",
        data: { id: "charge_1", metadata: { userId: "u1", tokenPackId: "pack_100" } },
      },
    });
    const ev = normalizeCrypto(payload);
    expect(ev).not.toBeNull();
    expect(ev?.eventType).toBe("transaction.completed");
    expect(ev?.eventType).not.toBe("subscription.activated");
    expect(ev?.userId).toBe("u1");
    expect(ev?.tokenPackId).toBe("pack_100");

    const resolved = normalizeCrypto(
      cryptoWebhookSchema.parse({
        event: { type: "charge:resolved", data: { metadata: { userId: "u2", tokenPackId: "pack_500" } } },
      }),
    );
    expect(resolved?.eventType).toBe("transaction.completed");
  });

  it("returns null (unmapped) for events without a mapped type or missing metadata", () => {
    const pending = cryptoWebhookSchema.parse({ event: { type: "charge:pending", data: {} } });
    expect(normalizeCrypto(pending)).toBeNull();

    const noMetadata = cryptoWebhookSchema.parse({ event: { type: "charge:confirmed", data: {} } });
    expect(normalizeCrypto(noMetadata)).toBeNull();
  });
});

describe("webhook body shape validation (Zod, trust boundary)", () => {
  it("ccbillWebhookSchema rejects a body missing eventType", () => {
    expect(ccbillWebhookSchema.safeParse({ subscriptionId: "s1" }).success).toBe(false);
  });
  it("ccbillWebhookSchema accepts a well-formed body", () => {
    expect(ccbillWebhookSchema.safeParse({ eventType: "NewSaleSuccess", userId: "u1" }).success).toBe(true);
  });

  it("verotelWebhookSchema rejects a body with a non-string field", () => {
    expect(verotelWebhookSchema.safeParse({ type: "approved", extra: { nested: true } }).success).toBe(false);
  });
  it("verotelWebhookSchema accepts a well-formed body", () => {
    expect(verotelWebhookSchema.safeParse({ type: "approved", userId: "u1", saleID: "s1" }).success).toBe(true);
  });

  it("segpayWebhookSchema rejects a body with a non-string field", () => {
    expect(segpayWebhookSchema.safeParse({ eventType: 123 }).success).toBe(false);
  });
  it("segpayWebhookSchema accepts a well-formed body", () => {
    expect(segpayWebhookSchema.safeParse({ eventType: "auth", userId: "u1" }).success).toBe(true);
  });

  it("cryptoWebhookSchema rejects a body missing event.type", () => {
    expect(cryptoWebhookSchema.safeParse({ event: { data: {} } }).success).toBe(false);
  });
  it("cryptoWebhookSchema accepts a well-formed body", () => {
    expect(
      cryptoWebhookSchema.safeParse({ event: { type: "charge:confirmed", data: { metadata: {} } } }).success,
    ).toBe(true);
  });
});
