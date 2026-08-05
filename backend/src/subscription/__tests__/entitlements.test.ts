import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@poppy/database";
import { entitlementsFor } from "../entitlements";
import { activatePlan } from "../grant";
import { planPeriodKey } from "../period";
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

describe.skipIf(!DB_UP)("entitlementsFor", () => {
  it("fresh free user: 10 chats, 0 media, inactive", async () => {
    const userId = await makeUser(0);
    const ent = await entitlementsFor(userId);
    expect(ent.plan).toBe("free");
    expect(ent.active).toBe(false);
    expect(ent.expiresAt).toBeNull();
    expect(ent.chats).toEqual({ limit: FREE_MESSAGE_LIMIT, used: 0, remaining: 10 });
    expect(ent.images.limit).toBe(0);
    expect(ent.videos.limit).toBe(0);
  });

  it("free user with used == limit has 0 remaining", async () => {
    const userId = await makeUser(FREE_MESSAGE_LIMIT);
    const ent = await entitlementsFor(userId);
    expect(ent.chats.remaining).toBe(0);
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
});
