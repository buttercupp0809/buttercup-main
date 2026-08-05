// Webhook integration test. Uses the live buttercupp_dev DB so recordEvent
// exercises the real unique-index dedupe. Signature-verification unit
// tests live alongside each provider file to stay in the same commit as
// any signing change.

import { describe, expect, it } from "vitest";
import { prisma } from "@buttercupp/database";
import { processSubscriptionEvent } from "./shared";
import type { NormalizedEvent } from "../types";
import { verifySignature as verifyCcbill } from "./ccbill";
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
