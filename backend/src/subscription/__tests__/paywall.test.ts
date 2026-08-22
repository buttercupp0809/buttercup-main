import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import {
  PaywallError,
  assertCanChat,
  assertCanImage,
  assertCanConsumeMedia,
  consumeFreeMessage,
  recordChatConsumption,
  recordImageConsumption,
  FREE_MESSAGE_LIMIT,
} from "../enforce";
import { activatePlan } from "../grant";
import { PLANS, type Plan } from "../plans";
import { planPeriodKey, type PlanCounterKind } from "../period";
import { entitlementsFor } from "../entitlements";
import { dbReachable } from "../../test-utils/db";

const DB_UP = await dbReachable();

async function makeUser(freeUsed = 0): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `pw-${crypto.randomUUID()}@test.local`,
      freeMessagesUsed: freeUsed,
    },
  });
  return u.id;
}

// Pin the plan-period usage counter to a chosen value so a test can exhaust a
// real quota in one write instead of consuming N times. Uses the same period
// key + counterType that entitlementsFor reads back.
async function setPlanUsage(
  userId: string,
  plan: Plan,
  kind: PlanCounterKind,
  count: number,
): Promise<void> {
  const ent = await entitlementsFor(userId);
  const period = planPeriodKey(plan, ent.expiresAt ? new Date(ent.expiresAt) : null);
  await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType: kind, period } },
    create: { userId, counterType: kind, period, count },
    update: { count },
  });
}

describe.skipIf(!DB_UP)("assertCanChat: free trial", () => {
  it("allows 10 messages, blocks the 11th with free_trial scope", async () => {
    const userId = await makeUser(0);
    for (let i = 0; i < FREE_MESSAGE_LIMIT; i++) {
      await assertCanChat(userId);
      await recordChatConsumption(userId);
    }
    // 11th should throw.
    await expect(assertCanChat(userId)).rejects.toMatchObject({
      name: "PaywallError",
      body: expect.objectContaining({ scope: "free_trial", kind: "chat" }),
    });
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.freeMessagesUsed).toBe(FREE_MESSAGE_LIMIT);
  });

  it("crisis intervention (no consumeChat call) does NOT bump the counter", async () => {
    const userId = await makeUser(0);
    // Simulate three "consumedChat=false" turns: recordChatConsumption is
    // skipped by callers, so the counter never moves.
    for (let i = 0; i < 3; i++) {
      await assertCanChat(userId);
      // Deliberately no recordChatConsumption() call.
    }
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.freeMessagesUsed).toBe(0);
  });
});

describe.skipIf(!DB_UP)("assertCanChat: active plan", () => {
  it("blocks with plan_quota scope when the plan chat quota is exhausted", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    // Exhaust the real daily chat quota, then the next check must paywall.
    await setPlanUsage(userId, "daily", "chat", PLANS.daily.chats);
    await expect(assertCanChat(userId)).rejects.toMatchObject({
      name: "PaywallError",
      body: expect.objectContaining({ scope: "plan_quota", kind: "chat" }),
    });
  });

  it("expired active row falls back to free trial gate", async () => {
    const userId = await makeUser(FREE_MESSAGE_LIMIT);
    await activatePlan(userId, "weekly");
    await prisma.subscription.update({
      where: { userId },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    // Free trial exhausted -> paywall with free_trial scope.
    await expect(assertCanChat(userId)).rejects.toMatchObject({
      body: expect.objectContaining({ scope: "free_trial" }),
    });
  });
});

describe.skipIf(!DB_UP)("assertCanConsumeMedia", () => {
  it("blocks a free user for image", async () => {
    const userId = await makeUser(0);
    await expect(assertCanConsumeMedia(userId, "image")).rejects.toMatchObject({
      body: expect.objectContaining({ scope: "plan_quota", kind: "image" }),
    });
  });

  it("blocks an active plan whose image quota is exhausted", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    // Exhaust the real daily image quota, then the next check must paywall.
    await setPlanUsage(userId, "daily", "image", PLANS.daily.images);
    await expect(assertCanConsumeMedia(userId, "image")).rejects.toMatchObject({
      body: expect.objectContaining({ scope: "plan_quota", kind: "image" }),
    });
  });
});

describe.skipIf(!DB_UP)("assertCanImage + recordImageConsumption", () => {
  it("free user: allows up to the free image allowance, blocks the next", async () => {
    const userId = await makeUser(0);
    const freeImages = PLANS.free.images;
    expect(freeImages).toBeGreaterThan(0);
    for (let i = 0; i < freeImages; i++) {
      await assertCanImage(userId);
      await recordImageConsumption(userId);
    }
    // Allowance spent -> next check paywalls with the free_trial scope.
    await expect(assertCanImage(userId)).rejects.toMatchObject({
      name: "PaywallError",
      body: expect.objectContaining({ scope: "free_trial", kind: "image" }),
    });
  });

  it("recordImageConsumption increments the image counter (free user)", async () => {
    const userId = await makeUser(0);
    let ent = await entitlementsFor(userId);
    expect(ent.images.used).toBe(0);
    await recordImageConsumption(userId);
    ent = await entitlementsFor(userId);
    expect(ent.images.used).toBe(1);
    expect(ent.images.remaining).toBe(PLANS.free.images - 1);
  });

  it("active plan: blocks when the image quota is exhausted, passes under limit", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    // Under the limit -> passes.
    await assertCanImage(userId);
    // Exhaust the real daily image quota -> next check paywalls.
    await setPlanUsage(userId, "daily", "image", PLANS.daily.images);
    await expect(assertCanImage(userId)).rejects.toMatchObject({
      name: "PaywallError",
      body: expect.objectContaining({ scope: "plan_quota", kind: "image" }),
    });
  });

  it("active plan: recordImageConsumption increments the plan image counter", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    await recordImageConsumption(userId);
    const ent = await entitlementsFor(userId);
    expect(ent.images.used).toBe(1);
  });
});

describe.skipIf(!DB_UP)("concurrent consumeFreeMessage is atomic", () => {
  it("K parallel increments land at exactly K, no lost updates", async () => {
    const userId = await makeUser(0);
    const K = 15;
    await Promise.all(Array.from({ length: K }, () => consumeFreeMessage(userId)));
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.freeMessagesUsed).toBe(K);
  });
});

describe("PaywallError shape", () => {
  it("carries status 402 and a body the transport can serialize", () => {
    const err = new PaywallError("test", 402, { hello: "world" });
    expect(err.status).toBe(402);
    expect(err.body).toEqual({ hello: "world" });
    expect(err.name).toBe("PaywallError");
  });
});
