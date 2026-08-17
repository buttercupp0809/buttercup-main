// Unit tests for the Dodo webhook verify + normalize path. The Dodo SDK
// webhook unwrap is mocked so we exercise signature-failure and event mapping
// deterministically without generating a real Standard-Webhooks signature.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unwrapMock = vi.fn();
vi.mock("dodopayments", () => {
  return {
    default: class DodoPaymentsMock {
      checkoutSessions = { create: vi.fn() };
      subscriptions = { update: vi.fn() };
      customers = { customerPortal: { create: vi.fn() } };
      webhooks = { unwrap: unwrapMock };
    },
  };
});

async function loadWebhookModule() {
  const dodoMod = await import("../dodo");
  dodoMod._resetClientForTests();
  return import("./dodo");
}

beforeEach(() => {
  process.env.DODO_API_KEY = "test_key";
  unwrapMock.mockReset();
});
afterEach(() => {
  delete process.env.DODO_API_KEY;
});

describe("dodo webhook verifyAndParse", () => {
  it("throws when the SDK signature check fails (tampered body)", async () => {
    const { verifyAndParse } = await loadWebhookModule();
    unwrapMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    expect(() => verifyAndParse("{}", { "webhook-id": "x" })).toThrow(/invalid signature/);
  });

  it("returns the SDK's parsed event when the signature is valid", async () => {
    const { verifyAndParse } = await loadWebhookModule();
    const evt = { type: "payment.succeeded", data: { payment_id: "pay_1" } };
    unwrapMock.mockReturnValue(evt);
    expect(verifyAndParse('{"x":1}', { "webhook-id": "id" })).toBe(evt);
  });
});

describe("dodo webhook normalize", () => {
  it("payment.succeeded with intent!=tokens normalizes to subscription.activated + plan", async () => {
    const { normalize } = await loadWebhookModule();
    const evt = {
      type: "payment.succeeded",
      business_id: "biz",
      timestamp: "2026-08-17T00:00:00Z",
      data: {
        payment_id: "pay_abc",
        subscription_id: undefined,
        total_amount: 100,
        currency: "USD",
        metadata: {
          userId: "user-1",
          intent: "subscription",
          plan: "daily",
          tokenPackId: "",
        },
      },
    };
    const n = normalize(evt as never);
    expect(n).not.toBeNull();
    expect(n?.provider).toBe("dodo");
    expect(n?.eventType).toBe("subscription.activated");
    expect(n?.plan).toBe("daily");
    expect(n?.tokenPackId).toBeUndefined();
    expect(n?.userId).toBe("user-1");
    expect(n?.eventId).toBe("pay_abc");
    expect(n?.currency).toBe("USD");
    expect(n?.amount).toBe(100);
  });

  it("payment.succeeded with intent=tokens normalizes to transaction.completed + tokenPackId", async () => {
    const { normalize } = await loadWebhookModule();
    const evt = {
      type: "payment.succeeded",
      business_id: "biz",
      timestamp: "2026-08-17T00:00:00Z",
      data: {
        payment_id: "pay_tok",
        total_amount: 800,
        currency: "USD",
        metadata: {
          userId: "user-9",
          intent: "tokens",
          plan: "",
          tokenPackId: "pack_500",
        },
      },
    };
    const n = normalize(evt as never);
    expect(n?.eventType).toBe("transaction.completed");
    expect(n?.tokenPackId).toBe("pack_500");
    expect(n?.plan).toBeUndefined();
    expect(n?.userId).toBe("user-9");
    expect(n?.eventId).toBe("pay_tok");
  });

  it("subscription.cancelled normalizes to subscription.canceled", async () => {
    const { normalize } = await loadWebhookModule();
    const evt = {
      type: "subscription.cancelled",
      business_id: "biz",
      timestamp: "2026-08-17T00:00:00Z",
      data: {
        subscription_id: "sub_1",
        metadata: { userId: "user-2", intent: "subscription", plan: "monthly" },
      },
    };
    const n = normalize(evt as never);
    expect(n?.eventType).toBe("subscription.canceled");
    expect(n?.externalSubscriptionId).toBe("sub_1");
    expect(n?.eventId).toBe("sub_1");
  });

  it("subscription.renewed normalizes to subscription.activated (pass re-extends via existing pipeline)", async () => {
    const { normalize } = await loadWebhookModule();
    const evt = {
      type: "subscription.renewed",
      business_id: "biz",
      timestamp: "2026-08-17T00:00:00Z",
      data: {
        subscription_id: "sub_r",
        metadata: { userId: "user-3", intent: "subscription", plan: "monthly" },
      },
    };
    const n = normalize(evt as never);
    expect(n?.eventType).toBe("subscription.activated");
    expect(n?.plan).toBe("monthly");
  });

  it("subscription.on_hold normalizes to subscription.past_due", async () => {
    const { normalize } = await loadWebhookModule();
    const n = normalize({
      type: "subscription.on_hold",
      business_id: "biz",
      timestamp: "2026-08-17T00:00:00Z",
      data: { subscription_id: "sub_h", metadata: { userId: "user-4" } },
    } as never);
    expect(n?.eventType).toBe("subscription.past_due");
  });

  it("returns null for an unmapped event type", async () => {
    const { normalize } = await loadWebhookModule();
    const n = normalize({
      type: "some.random_event",
      business_id: "biz",
      timestamp: "t",
      data: { metadata: { userId: "u" } },
    } as never);
    expect(n).toBeNull();
  });

  it("returns null when metadata.userId is missing (defense in depth)", async () => {
    const { normalize } = await loadWebhookModule();
    const n = normalize({
      type: "payment.succeeded",
      data: { payment_id: "p", metadata: {} },
    } as never);
    expect(n).toBeNull();
  });

  it("falls back to a synthesized eventId when no payment/subscription id is present", async () => {
    const { normalize } = await loadWebhookModule();
    const n = normalize({
      type: "payment.succeeded",
      business_id: "biz-42",
      timestamp: "1700000000",
      data: {
        metadata: { userId: "u", intent: "subscription", plan: "daily" },
      },
    } as never);
    expect(n?.eventId).toBe("payment.succeeded:biz-42:1700000000");
  });
});
