// Phase 27 payments checkout + token store E2E. Gated behind E2E_SEEDED=1 +
// E2E_VERIFIED_COOKIE (same convention as chat-gestures.spec.ts) because it
// needs an authenticated, age-verified session to reach /billing, /upgrade,
// and /chat/:characterId.
//
// Network calls to the backend (BACKEND_URL, default http://localhost:4000)
// are intercepted with page.route so these specs do not depend on a real
// CCBill/Verotel/SegPay/Coinbase Commerce sandbox account: "hosted checkout"
// is asserted by shape (a non-Stripe, provider-looking host), not by an
// actual redirect to a live processor.
//
// The "simulate a signed webhook" steps POST directly to the backend's
// POST /webhooks/:provider route using a LOCAL, test-only signing secret.
// They only work if the backend process under test has that same secret
// configured (e.g. SEGPAY_HMAC_KEY=e2e-test-secret in a local, untracked
// backend/.env used just for this test run). No live keys are used or
// required anywhere in this file.

import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

const seeded = process.env.E2E_SEEDED === "1";
const cookie = process.env.E2E_VERIFIED_COOKIE ?? "";
const characterId = process.env.E2E_CHARACTER_ID ?? "";
const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:4000";
const segpaySecret = process.env.E2E_SEGPAY_HMAC_KEY ?? "";

const MOCK_PLANS = [
  { plan: "free", label: "Free", priceUsd: 0, durationDays: 0, chats: 10, images: 0, videos: 0 },
  { plan: "daily", label: "Daily Pass", priceUsd: 1, durationDays: 1, chats: 150, images: 10, videos: 2 },
  { plan: "weekly", label: "Weekly Pass", priceUsd: 6, durationDays: 7, chats: 1200, images: 80, videos: 15 },
  { plan: "monthly", label: "Monthly Pass", priceUsd: 25, durationDays: 30, chats: 6000, images: 400, videos: 75 },
];

const MOCK_PACKS = [
  { id: "pack_100", credits: 100, label: "100 tokens", priceUsd: 2 },
  { id: "pack_500", credits: 500, label: "500 tokens", priceUsd: 8 },
];

test.describe("payments checkout + token store", () => {
  test.beforeEach(async ({ context }) => {
    test.skip(!seeded || !cookie, "needs E2E_SEEDED=1 and E2E_VERIFIED_COOKIE");
    await context.addCookies([
      { name: "buttercupp_auth", value: cookie, url: "http://localhost:3000" },
    ]);
  });

  test("upgrade flow: plan cards render from GET /billing/plans and Continue redirects to a hosted (non-Stripe) checkout URL", async ({
    page,
  }) => {
    let entitlementsCallCount = 0;

    await page.route(`${backendUrl}/billing/plans`, async (route) => {
      await route.fulfill({ json: { plans: MOCK_PLANS } });
    });
    await page.route(`${backendUrl}/billing/token-packs`, async (route) => {
      await route.fulfill({ json: { packs: MOCK_PACKS } });
    });
    await page.route(`${backendUrl}/billing/entitlements`, async (route) => {
      entitlementsCallCount += 1;
      const active = entitlementsCallCount > 1; // flips "active" after the simulated webhook lands
      await route.fulfill({
        json: active
          ? {
              plan: "weekly",
              active: true,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              chats: { limit: 1200, used: 0, remaining: 1200 },
              images: { limit: 80, used: 0, remaining: 80 },
              videos: { limit: 15, used: 0, remaining: 15 },
              freeMessagesUsed: 0,
            }
          : {
              plan: "free",
              active: false,
              expiresAt: null,
              chats: { limit: 10, used: 0, remaining: 10 },
              images: { limit: 0, used: 0, remaining: 0 },
              videos: { limit: 0, used: 0, remaining: 0 },
              freeMessagesUsed: 0,
            },
      });
    });
    await page.route(`${backendUrl}/billing/subscribe`, async (route) => {
      const body = route.request().postDataJSON() as { plan?: string };
      expect(body.plan).toBe("weekly");
      await route.fulfill({
        json: { provider: "ccbill", checkoutUrl: "https://api.ccbill.com/wap-frontflex/flexforms/mock", externalId: "ccbill:mock" },
      });
    });

    await page.goto("/upgrade?plan=weekly");
    await expect(page.getByTestId("plan-cards")).toBeVisible();
    await expect(page.getByTestId("plan-weekly")).toBeVisible();

    // Clicking Continue navigates the top-level page to the (mocked) hosted
    // checkout URL. We intercept the navigation instead of following it.
    const [navigation] = await Promise.all([
      page.waitForURL(/ccbill\.com/),
      page.getByTestId("buy-weekly").click(),
    ]);
    void navigation;
    const url = page.url();
    expect(url).toMatch(/ccbill\.com/);
    expect(url).not.toMatch(/stripe\.com/);
    expect(url).not.toMatch(/paypal\.com/);
  });

  test("paywall modal: free user at the chat limit sees a blocking modal, input is disabled until entitlements flip active", async ({
    page,
  }) => {
    test.skip(!characterId, "needs E2E_CHARACTER_ID");
    let entitlementsCallCount = 0;

    await page.route(`${backendUrl}/billing/entitlements`, async (route) => {
      entitlementsCallCount += 1;
      const active = entitlementsCallCount > 2; // resumes after a couple of polls
      await route.fulfill({
        json: active
          ? { plan: "daily", active: true, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), chats: { limit: 150, used: 0, remaining: 150 }, images: { limit: 10, used: 0, remaining: 10 }, videos: { limit: 2, used: 0, remaining: 2 }, freeMessagesUsed: 0 }
          : { plan: "free", active: false, expiresAt: null, chats: { limit: 10, used: 10, remaining: 0 }, images: { limit: 0, used: 0, remaining: 0 }, videos: { limit: 0, used: 0, remaining: 0 }, freeMessagesUsed: 10 },
      });
    });
    await page.route(`${backendUrl}/billing/plans`, async (route) => {
      await route.fulfill({ json: { plans: MOCK_PLANS } });
    });

    await page.goto(`/chat/${characterId}`);
    await page.getByTestId("chat-input").fill("hello");
    await page.getByTestId("chat-send").click();

    // The server-side chat transport (WS or SSE) is expected to emit a real
    // `paywall` frame once the seeded free user's 10-message allowance is
    // exhausted; this spec assumes the DB seed already put the user at the
    // limit so the very first send triggers it.
    await expect(page.getByTestId("paywall-modal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-input")).toBeDisabled();

    // ESC hides the dialog chrome but must NOT re-enable the input.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("paywall-modal")).toBeHidden();
    await expect(page.getByTestId("chat-input")).toBeDisabled();
    await page.getByTestId("paywall-reopen").click();
    await expect(page.getByTestId("paywall-modal")).toBeVisible();

    // Entitlements flip active after the mocked poll count above; the modal
    // polls every 5s, so allow enough time for two ticks.
    await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 15_000 });
  });

  test("token store: buying a pack redirects to hosted checkout; balance updates after the webhook lands", async ({
    page,
  }) => {
    let statusCallCount = 0;

    await page.route(`${backendUrl}/billing/plans`, async (route) => {
      await route.fulfill({ json: { plans: MOCK_PLANS } });
    });
    await page.route(`${backendUrl}/billing/entitlements`, async (route) => {
      await route.fulfill({
        json: { plan: "free", active: false, expiresAt: null, chats: { limit: 10, used: 0, remaining: 10 }, images: { limit: 0, used: 0, remaining: 0 }, videos: { limit: 0, used: 0, remaining: 0 }, freeMessagesUsed: 0 },
      });
    });
    await page.route(`${backendUrl}/billing/token-packs`, async (route) => {
      await route.fulfill({ json: { packs: MOCK_PACKS } });
    });
    await page.route("**/api/billing/status", async (route) => {
      statusCallCount += 1;
      const credited = statusCallCount > 1;
      await route.fulfill({
        json: {
          plan: "free",
          tier: "free",
          status: "inactive",
          currentPeriodEnd: null,
          tokenBalance: credited ? 100 : 0,
          entitlements: { chats: { limit: 10, used: 0, remaining: 10 }, images: { limit: 0, used: 0, remaining: 0 }, videos: { limit: 0, used: 0, remaining: 0 } },
          grants: { voice: false, image: false, premiumModel: false },
        },
      });
    });
    await page.route(`${backendUrl}/billing/tokens`, async (route) => {
      const body = route.request().postDataJSON() as { packId?: string };
      expect(body.packId).toBe("pack_100");
      await route.fulfill({
        json: { provider: "crypto", checkoutUrl: "https://commerce.coinbase.com/checkout/mock", externalId: "crypto:mock" },
      });
    });

    await page.goto("/billing");
    await expect(page.getByTestId("token-store")).toBeVisible();
    await expect(page.getByTestId("token-balance")).toContainText("0");

    const [navigation] = await Promise.all([
      page.waitForURL(/commerce\.coinbase\.com/),
      page.getByTestId("buy-pack-pack_100").click(),
    ]);
    void navigation;
    expect(page.url()).toMatch(/commerce\.coinbase\.com/);

    // Simulate returning from checkout: reload the billing page (the token
    // store's resume poll picks up the sessionStorage marker set before the
    // redirect) and assert the balance eventually reflects the credited pack.
    await page.goto("/billing");
    await expect(page.getByTestId("token-balance")).toContainText("100", { timeout: 15_000 });
  });

  test("simulated SegPay activation webhook flips entitlements to active (local signing secret only)", async ({
    request,
  }) => {
    test.skip(!segpaySecret, "needs E2E_SEGPAY_HMAC_KEY set to match the backend's local SEGPAY_HMAC_KEY");
    const userId = process.env.E2E_USER_ID ?? "";
    test.skip(!userId, "needs E2E_USER_ID for the webhook payload");

    const body = {
      eventType: "auth",
      transactionID: `e2e-${Date.now()}`,
      userId,
      tier: "premium",
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha1", segpaySecret).update(raw).digest("hex");

    const res = await request.post(`${backendUrl}/webhooks/segpay`, {
      data: raw,
      headers: { "content-type": "application/json", "x-segpay-signature": signature },
    });
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as { applied: boolean; effect: string };
    expect(json.applied).toBe(true);

    // Replay: idempotency should now report a no-op.
    const replay = await request.post(`${backendUrl}/webhooks/segpay`, {
      data: raw,
      headers: { "content-type": "application/json", "x-segpay-signature": signature },
    });
    const replayJson = (await replay.json()) as { applied: boolean; effect: string };
    expect(replayJson.applied).toBe(false);
    expect(replayJson.effect).toBe("duplicate");
  });
});
