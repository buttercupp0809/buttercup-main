import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import { entitlementsFor } from "../entitlements";
import { activatePlan } from "../grant";
import { freeChatPeriodKey, planPeriodKey } from "../period";
import { FREE_MESSAGE_LIMIT, PLANS } from "../plans";
import { dbReachable } from "../../test-utils/db";

const DB_UP = await dbReachable();

async function makeUser(freeUsed = 0): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `ent-${crypto.randomUUID()}@test.local`,
      freeMessagesUsed: freeUsed,
    },
  });
  return u.id;
}

async function setFreeChatsUsed(userId: string, count: number): Promise<void> {
  const period = freeChatPeriodKey();
  await prisma.usageCounter.upsert({
    where: { userId_counterType_period: { userId, counterType: "chat", period } },
    create: { userId, counterType: "chat", period, count },
    update: { count },
  });
}

describe.skipIf(!DB_UP)("entitlementsFor", () => {
  it("fresh free user: 15 chats, 0 media, inactive, resetsAt set", async () => {
    const userId = await makeUser(0);
    const ent = await entitlementsFor(userId);
    expect(ent.plan).toBe("free");
    expect(ent.active).toBe(false);
    expect(ent.expiresAt).toBeNull();
    expect(ent.chats).toEqual({ limit: FREE_MESSAGE_LIMIT, used: 0, remaining: 15 });
    expect(ent.images.limit).toBe(PLANS.free.images);
    expect(ent.videos.limit).toBe(0);
    expect(ent.resetsAt).not.toBeNull();
    expect(new Date(ent.resetsAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("free user with today's daily counter == limit has 0 remaining", async () => {
    const userId = await makeUser(0);
    await setFreeChatsUsed(userId, FREE_MESSAGE_LIMIT);
    const ent = await entitlementsFor(userId);
    expect(ent.chats.used).toBe(FREE_MESSAGE_LIMIT);
    expect(ent.chats.remaining).toBe(0);
  });

  it("legacy freeMessagesUsed no longer gates chat", async () => {
    // A user whose lifetime counter is far above the daily limit but who
    // has NOT chatted today should still see the full daily allowance.
    const userId = await makeUser(1000);
    const ent = await entitlementsFor(userId);
    expect(ent.chats.remaining).toBe(FREE_MESSAGE_LIMIT);
  });

  it("active daily pass: quotas minus UsageCounter counts", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    const period = planPeriodKey("daily", sub!.currentPeriodEnd ?? null);
    // Simulate 3 chats used against this pass window.
    await prisma.usageCounter.create({
      data: { userId, counterType: "chat", period, count: 3 },
    });
    const ent = await entitlementsFor(userId);
    expect(ent.plan).toBe("daily");
    expect(ent.active).toBe(true);
    expect(ent.expiresAt).not.toBeNull();
    const chatLimit = PLANS.daily.chats;
    expect(ent.chats.limit).toBe(chatLimit);
    expect(ent.chats.used).toBe(3);
    // Placeholder chats may be 0 which would make remaining 0; guard the
    // check so the test passes both pre- and post-tuning.
    if (chatLimit > 0) {
      expect(ent.chats.remaining).toBe(Math.max(0, chatLimit - 3));
    } else {
      expect(ent.chats.remaining).toBe(0);
    }
  });

  it("active sub_monthly returns 5000 / 300 / 60 quotas", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "sub_monthly");
    const ent = await entitlementsFor(userId);
    expect(ent.plan).toBe("sub_monthly");
    expect(ent.active).toBe(true);
    expect(ent.chats.limit).toBe(5000);
    expect(ent.images.limit).toBe(300);
    expect(ent.videos.limit).toBe(60);
    // With no usage rows, remaining equals the limit.
    expect(ent.chats.remaining).toBe(5000);
    expect(ent.images.remaining).toBe(300);
    expect(ent.videos.remaining).toBe(60);
  });

  it("expired pass resolves back to free", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "weekly");
    // Force expiry into the past.
    await prisma.subscription.update({
      where: { userId },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    const ent = await entitlementsFor(userId);
    expect(ent.plan).toBe("free");
    expect(ent.active).toBe(false);
  });

  it("paid plan has null resetsAt (paid-plan reset is expiresAt / monthly key)", async () => {
    const userId = await makeUser(0);
    await activatePlan(userId, "daily");
    const ent = await entitlementsFor(userId);
    expect(ent.resetsAt).toBeNull();
  });
});
