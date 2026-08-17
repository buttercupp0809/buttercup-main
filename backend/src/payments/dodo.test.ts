// Unit tests for the Dodo Payments adapter. No network + no DB. The Dodo
// SDK's checkoutSessions.create is stubbed so we exercise env resolution,
// metadata contract shape, and error paths deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutRequest } from "./types";

const createMock = vi.fn();

vi.mock("dodopayments", () => {
  return {
    default: class DodoPaymentsMock {
      checkoutSessions = { create: createMock };
      subscriptions = { update: vi.fn() };
      customers = { customerPortal: { create: vi.fn() } };
      webhooks = { unwrap: vi.fn() };
    },
  };
});

async function loadAdapter() {
  const mod = await import("./dodo");
  mod._resetClientForTests();
  return mod;
}

const BASE_ENV_KEYS = [
  "DODO_API_KEY",
  "DODO_ENVIRONMENT",
  "DODO_WEBHOOK_KEY",
  "DODO_PRODUCT_DAILY",
  "DODO_PRODUCT_WEEKLY",
  "DODO_PRODUCT_MONTHLY",
  "DODO_PRODUCT_PACK_100",
  "DODO_PRODUCT_PACK_500",
  "DODO_PRODUCT_PACK_2000",
];

function clearEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of BASE_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return saved;
}
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("dodo adapter", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = clearEnv();
    createMock.mockReset();
  });
  afterEach(() => {
    restoreEnv(saved);
  });

  it("isConfigured() is false without DODO_API_KEY", async () => {
    const { isConfigured } = await loadAdapter();
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured() is true once DODO_API_KEY is set", async () => {
    process.env.DODO_API_KEY = "test_key";
    const { isConfigured } = await loadAdapter();
    expect(isConfigured()).toBe(true);
  });

  it("createCheckout throws when the plan's product env var is missing", async () => {
    process.env.DODO_API_KEY = "test_key";
    const { createCheckout } = await loadAdapter();
    await expect(
      createCheckout({
        userId: "u1",
        intent: "subscription",
        plan: "daily",
        successUrl: "https://s",
        cancelUrl: "https://c",
      }),
    ).rejects.toThrow(/dodo_missing_product:DODO_PRODUCT_DAILY/);
  });

  it("createCheckout throws when the token pack's product env var is missing", async () => {
    process.env.DODO_API_KEY = "test_key";
    const { createCheckout } = await loadAdapter();
    await expect(
      createCheckout({
        userId: "u1",
        intent: "tokens",
        tokenPackId: "pack_500",
        successUrl: "https://s",
        cancelUrl: "https://c",
      }),
    ).rejects.toThrow(/dodo_missing_product:DODO_PRODUCT_PACK_500/);
  });

  it.each([
    ["daily", "DODO_PRODUCT_DAILY", "prod_daily_id"],
    ["weekly", "DODO_PRODUCT_WEEKLY", "prod_weekly_id"],
    ["monthly", "DODO_PRODUCT_MONTHLY", "prod_monthly_id"],
  ])("createCheckout for plan=%s resolves %s and carries metadata", async (plan, envKey, productId) => {
    process.env.DODO_API_KEY = "test_key";
    process.env[envKey] = productId;
    createMock.mockResolvedValue({ checkout_url: "https://dodo/checkout/abc", session_id: "sess_123" });

    const { createCheckout } = await loadAdapter();
    const req: CheckoutRequest = {
      userId: "user-42",
      intent: "subscription",
      plan: plan as "daily" | "weekly" | "monthly",
      successUrl: "https://s",
      cancelUrl: "https://c",
    };
    const resp = await createCheckout(req);
    expect(resp).toEqual({
      provider: "dodo",
      checkoutUrl: "https://dodo/checkout/abc",
      externalId: "sess_123",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.product_cart).toEqual([{ product_id: productId, quantity: 1 }]);
    expect(arg.return_url).toBe("https://s");
    expect(arg.cancel_url).toBe("https://c");
    expect(arg.metadata).toEqual({
      userId: "user-42",
      intent: "subscription",
      plan,
      tokenPackId: "",
    });
  });

  it.each([
    ["pack_100", "DODO_PRODUCT_PACK_100"],
    ["pack_500", "DODO_PRODUCT_PACK_500"],
    ["pack_2000", "DODO_PRODUCT_PACK_2000"],
  ])("createCheckout for tokenPackId=%s resolves %s and carries tokens metadata", async (packId, envKey) => {
    process.env.DODO_API_KEY = "test_key";
    process.env[envKey] = `prod_${packId}`;
    createMock.mockResolvedValue({ checkout_url: "https://dodo/checkout/xyz", session_id: "sess_xyz" });

    const { createCheckout } = await loadAdapter();
    const resp = await createCheckout({
      userId: "user-9",
      intent: "tokens",
      tokenPackId: packId,
      successUrl: "https://s",
      cancelUrl: "https://c",
    });
    expect(resp.provider).toBe("dodo");
    expect(resp.checkoutUrl).toBe("https://dodo/checkout/xyz");
    const arg = createMock.mock.calls[0][0];
    expect(arg.product_cart[0].product_id).toBe(`prod_${packId}`);
    expect(arg.metadata).toEqual({
      userId: "user-9",
      intent: "tokens",
      plan: "",
      tokenPackId: packId,
    });
  });

  it("createCheckout throws when Dodo returns no checkout_url", async () => {
    process.env.DODO_API_KEY = "test_key";
    process.env.DODO_PRODUCT_DAILY = "prod_daily";
    createMock.mockResolvedValue({ checkout_url: null, session_id: "sess_x" });
    const { createCheckout } = await loadAdapter();
    await expect(
      createCheckout({
        userId: "u",
        intent: "subscription",
        plan: "daily",
        successUrl: "https://s",
        cancelUrl: "https://c",
      }),
    ).rejects.toThrow(/dodo_no_checkout_url/);
  });
});
