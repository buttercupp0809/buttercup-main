// Unit + integration tests for the free-tier photo paywall feature.
//
// Tests:
//   1. Entitlement-to-lock mapping: free -> locked, active -> unlocked
//   2. assertCanTease: allows under cap, signals reuse at/over cap
//   3. Worker skips debitTokens and consumePlanQuota for billing=free_teaser
//   4. CTA line selection is stable per mediaAssetId

import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@buttercupp/database";
import {
  assertCanTease,
  incrementTeaserCounter,
  FREE_TEASER_DAILY_CAP,
} from "../enforce";
import { entitlementsFor } from "../entitlements";
import { ctaLineFor } from "../teaser-cta";
import { dbReachable } from "../../test-utils/db";
import { activatePlan } from "../grant";

const DB_UP = await dbReachable();

// ---------------------------------------------------------------------------
// CTA copy (pure, no DB needed)
// ---------------------------------------------------------------------------

describe("ctaLineFor: stable per mediaAssetId", () => {
  it("returns the same line for the same id across calls", () => {
    const id = "asset-abc-123";
    expect(ctaLineFor(id)).toBe(ctaLineFor(id));
  });

  it("returns different lines for different ids (probabilistic)", () => {
    // With 8 CTA lines, two random 36-char UUIDs will produce the same line
    // with probability 1/8. We pick 20 ids and assert at least 2 are distinct.
    const lines = new Set(Array.from({ length: 20 }, () => ctaLineFor(crypto.randomUUID())));
    expect(lines.size).toBeGreaterThan(1);
  });

  it("selection index is stable (deterministic hash)", () => {
    const id = "fixed-test-id-999";
    const line1 = ctaLineFor(id);
    const line2 = ctaLineFor(id);
    const line3 = ctaLineFor(id, "Alice");
    expect(line1).toBe(line2);
    // With a characterName the line content may differ but the same slot is chosen.
    // Both are non-empty strings.
    expect(typeof line3).toBe("string");
    expect(line3.length).toBeGreaterThan(0);
  });

  it("m-4: at least one CTA line actually interpolates the character name", () => {
    // Find an id that selects a line containing the {characterName} placeholder,
    // then assert the name appears in the output and the placeholder does not.
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const id = `interp-${i}`;
      const withName = ctaLineFor(id, "Luna");
      if (withName.includes("Luna")) {
        found = true;
        expect(withName).not.toContain("{characterName}");
      }
    }
    expect(found).toBe(true);
  });

  it("m-4: never leaks the raw {characterName} placeholder when no name given", () => {
    for (let i = 0; i < 50; i++) {
      const line = ctaLineFor(`noname-${i}`);
      expect(line).not.toContain("{characterName}");
    }
  });
});

// ---------------------------------------------------------------------------
// Entitlement-to-lock mapping
// ---------------------------------------------------------------------------

describe.skipIf(!DB_UP)("entitlements: free -> locked, paid -> unlocked", () => {
  async function makeUser(): Promise<string> {
    const u = await prisma.user.create({
      data: { email: `paywall-${crypto.randomUUID()}@test.local` },
    });
    return u.id;
  }

  it("free user has active=false (locked)", async () => {
    const userId = await makeUser();
    const ent = await entitlementsFor(userId);
    expect(ent.active).toBe(false);
    expect(ent.plan).toBe("free");
  });

  it("paid user has active=true (unlocked)", async () => {
    const userId = await makeUser();
    await activatePlan(userId, "daily");
    const ent = await entitlementsFor(userId);
    expect(ent.active).toBe(true);
    expect(ent.plan).not.toBe("free");
  });

  it("expired paid user falls back to free (locked)", async () => {
    const userId = await makeUser();
    await activatePlan(userId, "daily");
    await prisma.subscription.update({
      where: { userId },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    const ent = await entitlementsFor(userId);
    expect(ent.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertCanTease
// ---------------------------------------------------------------------------

describe.skipIf(!DB_UP)("assertCanTease: cap counter", () => {
  async function makeUser(): Promise<string> {
    const u = await prisma.user.create({
      data: { email: `tease-${crypto.randomUUID()}@test.local` },
    });
    return u.id;
  }

  function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async function setTeaserCount(userId: string, count: number): Promise<void> {
    const period = todayKey();
    await prisma.usageCounter.upsert({
      where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period } },
      create: { userId, counterType: "free_teaser_image", period, count },
      update: { count },
    });
  }

  it("allows generation when count < cap", async () => {
    const userId = await makeUser();
    const result = await assertCanTease(userId, null);
    expect(result.action).toBe("generate");
  });

  it("allows generation on the request that reaches exactly the cap", async () => {
    const userId = await makeUser();
    // Pre-set to cap-1; the next call increments to cap (== 25) and is the
    // last allowed generation.
    await setTeaserCount(userId, FREE_TEASER_DAILY_CAP - 1);
    const result = await assertCanTease(userId, null);
    expect(result.action).toBe("generate");
    // Counter is now exactly at the cap.
    const row = await prisma.usageCounter.findUnique({
      where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period: todayKey() } },
    });
    expect(row?.count).toBe(FREE_TEASER_DAILY_CAP);
  });

  it("I-1: concurrent burst past the cap does NOT all generate (atomic increment)", async () => {
    const userId = await makeUser();
    // Seed the counter to one below the cap so a burst straddles the boundary.
    await setTeaserCount(userId, FREE_TEASER_DAILY_CAP - 1);
    // Give the user an existing ready asset so over-cap calls resolve to reuse.
    await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "ready", s3Key: "images/test/burst.png" },
    });
    // Fire 10 concurrent requests. Exactly ONE may generate (the one that
    // lands on count == cap); every other must be routed to reuse.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => assertCanTease(userId, null)),
    );
    const generates = results.filter((r) => r.action === "generate");
    expect(generates).toHaveLength(1);
    // The final counter reflects all 10 atomic increments (no lost updates).
    const row = await prisma.usageCounter.findUnique({
      where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period: todayKey() } },
    });
    expect(row?.count).toBe(FREE_TEASER_DAILY_CAP - 1 + 10);
  });

  it("signals generate (not reuse) at/over cap when no existing asset exists", async () => {
    const userId = await makeUser();
    await setTeaserCount(userId, FREE_TEASER_DAILY_CAP);
    // No existing ready image asset -> must allow one generation to avoid dead end.
    const result = await assertCanTease(userId, null);
    expect(result.action).toBe("generate");
  });

  it("signals reuse at/over cap when a ready asset exists", async () => {
    const userId = await makeUser();
    await setTeaserCount(userId, FREE_TEASER_DAILY_CAP);

    // Create a ready image asset for this user.
    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "ready", s3Key: "images/test/fake.png" },
    });

    const result = await assertCanTease(userId, null);
    expect(result.action).toBe("reuse");
    if (result.action === "reuse") {
      expect(result.existingAssetId).toBe(asset.id);
    }
  });

  it("incrementTeaserCounter is atomic: K parallel increments land at exactly K", async () => {
    const userId = await makeUser();
    const K = 5;
    await Promise.all(Array.from({ length: K }, () => incrementTeaserCounter(userId)));
    const row = await prisma.usageCounter.findUnique({
      where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period: todayKey() } },
    });
    expect(row?.count).toBe(K);
  });

  it("counter resets between UTC days (period key differs)", async () => {
    const userId = await makeUser();
    // Seed yesterday's counter at cap.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await prisma.usageCounter.upsert({
      where: { userId_counterType_period: { userId, counterType: "free_teaser_image", period: yesterday } },
      create: { userId, counterType: "free_teaser_image", period: yesterday, count: FREE_TEASER_DAILY_CAP },
      update: { count: FREE_TEASER_DAILY_CAP },
    });
    // Today's counter is still 0 -> assertCanTease must allow generation.
    const result = await assertCanTease(userId, null);
    expect(result.action).toBe("generate");
  });
});

// ---------------------------------------------------------------------------
// Worker: billing=free_teaser skips debitTokens and consumePlanQuota
// ---------------------------------------------------------------------------

vi.mock("../../media/handlers", () => ({
  handlers: {
    image: vi.fn().mockResolvedValue({
      buffer: Buffer.from("fake-image-bytes"),
      contentType: "image/png",
      meta: { provider: "stub" },
    }),
  },
}));

vi.mock("../../media/storage", () => ({
  uploadMedia: vi.fn().mockResolvedValue("images/stub-user/fake-key.png"),
  getSignedUrl: vi.fn().mockResolvedValue("https://cdn.example.com/fake-key.png?sig=stub"),
  // fetchObjectBytes is consumed by the blur module (media/blur.ts). Return a
  // small valid 8x8 PNG so blurredDataUriForKey produces a real webp data URI
  // rather than the gradient fallback (lets the free_teaser payload assert a
  // NON-fallback blurUri). A 1x1 PNG is too small for sharp's resize pipeline.
  fetchObjectBytes: vi.fn().mockResolvedValue(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWOoCFiAFTEMLQkAINVaAfO5fyQAAAAASUVORK5CYII=",
      "base64",
    ),
  ),
}));

vi.mock("../../queue/ws-notify", () => ({
  notifyMediaReady: vi.fn().mockResolvedValue(undefined),
  notifyMediaError: vi.fn().mockResolvedValue(undefined),
}));

const { processJob } = await import("../../queue/media-worker");
const { notifyMediaReady } = await import("../../queue/ws-notify");

describe.skipIf(!DB_UP)("media-worker: free_teaser billing skips debit and quota", () => {
  async function makeUser(): Promise<{ userId: string; characterId: string }> {
    const u = await prisma.user.create({
      data: { email: `worker-tease-${crypto.randomUUID()}@test.local`, tokenBalance: 0 },
    });
    const appearance = await prisma.appearanceSheet.create({
      data: { traits: {}, stylePrompt: "test style", negativePrompt: "", referenceImageKeys: [] },
    });
    const voice = await prisma.voiceProfile.create({
      data: { provider: "system", voiceId: "default", params: {} },
    });
    const character = await prisma.character.create({
      data: {
        ownerUserId: u.id,
        name: "Tease Test",
        age: 21,
        gender: "female",
        bio: "bio",
        tags: [],
        style: "realistic",
        contentRating: "sfw",
        visibility: "private",
        moderationStatus: "pending",
      },
    });
    const version = await prisma.characterVersion.create({
      data: {
        characterId: character.id,
        versionNo: 1,
        personality: "",
        backstory: "",
        behavioralInstructions: "",
        greeting: "hi",
        appearanceSheetId: appearance.id,
        voiceProfileId: voice.id,
        systemPromptSnapshot: "",
      },
    });
    await prisma.character.update({ where: { id: character.id }, data: { currentVersionId: version.id } });
    return { userId: u.id, characterId: character.id };
  }

  it("free_teaser job succeeds even when tokenBalance=0 (no debit attempted)", async () => {
    const { userId } = await makeUser();
    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "queued" },
    });

    const result = await processJob({
      id: "tease-job-1",
      data: {
        mediaAssetId: asset.id,
        userId,
        conversationId: null,
        characterId: null,
        kind: "image",
        tokenCost: 0,
        payload: {},
        billing: "free_teaser",
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    expect(result.ok).toBe(true);
    // Confirm no token ledger row was written.
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger).toHaveLength(0);
  });

  it("free_teaser job does not increment plan quota counter", async () => {
    const { userId } = await makeUser();
    // Activate a plan so consumePlanQuota would normally fire.
    await activatePlan(userId, "daily");

    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "queued" },
    });
    const entBefore = await entitlementsFor(userId);
    const usedBefore = entBefore.images.used;

    await processJob({
      id: "tease-job-2",
      data: {
        mediaAssetId: asset.id,
        userId,
        conversationId: null,
        characterId: null,
        kind: "image",
        tokenCost: 0,
        payload: {},
        billing: "free_teaser",
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    const entAfter = await entitlementsFor(userId);
    // The image quota must NOT have incremented.
    expect(entAfter.images.used).toBe(usedBefore);
  });

  it("non-free-teaser job still follows the normal billing path", async () => {
    const { userId } = await makeUser();
    // Give the user enough tokens.
    await prisma.user.update({ where: { id: userId }, data: { tokenBalance: 100 } });

    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "queued" },
    });
    await processJob({
      id: "normal-job-1",
      data: {
        mediaAssetId: asset.id,
        userId,
        conversationId: null,
        characterId: null,
        kind: "image",
        tokenCost: 20,
        payload: {},
        // no billing field
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    // A debit ledger row must exist.
    const ledger = await prisma.tokenLedger.findMany({ where: { userId } });
    expect(ledger.length).toBeGreaterThan(0);
  });

  it("C-1: free_teaser notify carries locked + a REAL blurUri and NO real url", async () => {
    const { userId } = await makeUser();
    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "queued" },
    });

    vi.mocked(notifyMediaReady).mockClear();

    await processJob({
      id: "tease-job-blur",
      data: {
        mediaAssetId: asset.id,
        userId,
        conversationId: "conv-x",
        characterId: null,
        kind: "image",
        tokenCost: 0,
        payload: {},
        billing: "free_teaser",
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    expect(notifyMediaReady).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(notifyMediaReady).mock.calls[0]!;
    expect(payload.locked).toBe(true);
    // NO real presigned url or s3Key proxy url reaches the client.
    expect(payload.url).toBe("");
    // The blurUri is a REAL inline data URI (not the gradient fallback SVG),
    // because fetchObjectBytes returned valid image bytes for the blur.
    expect(payload.blurUri).toMatch(/^data:image\/webp;base64,/);
  });

  it("non-free-teaser notify carries the real proxy url and no locked flag", async () => {
    const { userId } = await makeUser();
    await prisma.user.update({ where: { id: userId }, data: { tokenBalance: 100 } });
    const asset = await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "queued" },
    });

    vi.mocked(notifyMediaReady).mockClear();

    await processJob({
      id: "normal-job-notify",
      data: {
        mediaAssetId: asset.id,
        userId,
        conversationId: "conv-y",
        characterId: null,
        kind: "image",
        tokenCost: 20,
        payload: {},
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    const [, payload] = vi.mocked(notifyMediaReady).mock.calls[0]!;
    expect(payload.locked).toBeUndefined();
    expect(payload.url).toContain("/api/media?k=");
    expect(payload.blurUri).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ADD: full payload flow. free ask -> asset ready -> payload has locked+blurUri
// and NO real url -> simulate payment (entitlement active) -> the SAME asset
// now delivers a real presigned url (no blur).
//
// This exercises the payload-shaping decision the delivery paths make: it is
// driven entirely by entitlementsFor(userId).active, computed at delivery time
// (no stored `locked` column, so payment auto-unlocks retroactively).
//
// TEST-GAP NOTE (M-1): the free/live SSE + WS branches in
// backend/src/http/chat-stream.ts and backend/src/ws/gateway.ts are NOT driven
// directly here. The `shapePayload` helper below RE-IMPLEMENTS their
// entitlement-based locked/blurUri decision (the two handlers are HTTP
// req/res + WebSocket bound and also invoke the LLM teaser + GPU generation,
// so exercising them end to end needs a heavier harness than a unit test).
// The BullMQ worker delivery path IS covered for real (see the "C-1" and
// "non-free-teaser notify" cases above, which call the real processJob and
// assert on the real notifyMediaReady payload). If the handlers' shaping logic
// changes, update `shapePayload` to match, or extract a shared payload-shaping
// helper both the handlers and this test import. Deliberately not over-invested
// per the final review ruling.
// ---------------------------------------------------------------------------

const { blurredDataUriForKey } = await import("../../media/blur");

describe.skipIf(!DB_UP)("full payload flow: free locked -> pay -> unlocked", () => {
  async function makeUser(): Promise<string> {
    const u = await prisma.user.create({
      data: { email: `flow-${crypto.randomUUID()}@test.local` },
    });
    return u.id;
  }

  // Mirrors the delivery-path decision in chat-stream.ts / gateway.ts: shape a
  // media payload for a given viewer + ready asset. Free -> locked+blurUri+no
  // url; paid -> real proxy url + no lock.
  async function shapePayload(userId: string, s3Key: string) {
    const ent = await entitlementsFor(userId);
    if (!ent.active) {
      return {
        locked: true as const,
        blurUri: await blurredDataUriForKey(s3Key),
        url: "",
      };
    }
    return {
      locked: false as const,
      url: `/api/media?k=${encodeURIComponent(s3Key)}`,
    };
  }

  it("same asset: locked+blurUri when free, real url after payment (no backfill)", async () => {
    const userId = await makeUser();
    const s3Key = "images/flow/teaser.png";
    // The teaser asset was generated and is ready in S3.
    await prisma.mediaAsset.create({
      data: { userId, kind: "image", status: "ready", s3Key },
    });

    // 1. Free viewer: payload is locked with a real inline blur and NO url/key.
    const freePayload = await shapePayload(userId, s3Key);
    expect(freePayload.locked).toBe(true);
    expect(freePayload.url).toBe("");
    if (freePayload.locked) {
      expect(freePayload.blurUri).toMatch(/^data:image\/(webp|svg\+xml);base64,/);
    }

    // 2. Simulate payment: flip the subscription to an active plan.
    await activatePlan(userId, "daily");

    // 3. The SAME asset now delivers a real presigned proxy url, no blur.
    const paidPayload = await shapePayload(userId, s3Key);
    expect(paidPayload.locked).toBe(false);
    expect(paidPayload.url).toContain("/api/media?k=");
    // No blurUri field on the unlocked payload.
    expect((paidPayload as { blurUri?: string }).blurUri).toBeUndefined();
  });
});
