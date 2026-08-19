// Phase 34 (Feature B) billing tabs E2E. Follows the same shape as
// payments-checkout.spec.ts: gated behind E2E_SEEDED + E2E_VERIFIED_COOKIE
// and mocks the backend catalog + entitlements with page.route so it does
// not depend on a real Prisma seed.
//
// Coverage:
//   - Default state: the Subscription tab is active, the subscriptions
//     section renders, the passes section is not in the DOM, and the token
//     store section is not present.
//   - Clicking Passes swaps the panels: the passes grid renders (with
//     daily / weekly / monthly tiles) and the subscriptions section is gone.
//   - The token store test id is never in the document in either tab (the
//     `SHOW_TOKEN_PACKS` flag hides the section behind a constant).

import { test, expect } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";
const cookie = process.env.E2E_VERIFIED_COOKIE ?? "";
const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:4000";

const MOCK_PLANS = [
  { plan: "free", label: "Free", priceUsd: 0, durationDays: 0, chats: 10, images: 0, videos: 0 },
  { plan: "daily", label: "Daily Pass", priceUsd: 1, durationDays: 1, chats: 150, images: 10, videos: 2 },
  { plan: "weekly", label: "Weekly Pass", priceUsd: 6, durationDays: 7, chats: 1200, images: 80, videos: 15 },
  { plan: "monthly", label: "Monthly Pass", priceUsd: 25, durationDays: 30, chats: 6000, images: 400, videos: 75 },
  {
    plan: "sub_monthly",
    label: "Monthly Subscription",
    priceUsd: 19.99,
    durationDays: 30,
    chats: 5000,
    images: 300,
    videos: 60,
    recurring: true,
    billingInterval: "month",
  },
  {
    plan: "sub_yearly",
    label: "Yearly Subscription",
    priceUsd: 149,
    durationDays: 365,
    chats: 5000,
    images: 300,
    videos: 60,
    recurring: true,
    billingInterval: "year",
  },
];

const FREE_ENTITLEMENTS = {
  plan: "free",
  active: false,
  expiresAt: null,
  chats: { limit: 10, used: 0, remaining: 10 },
  images: { limit: 0, used: 0, remaining: 0 },
  videos: { limit: 0, used: 0, remaining: 0 },
  freeMessagesUsed: 0,
};

test.describe("billing tabs (Subscription / Passes) and hidden token packs", () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(!seeded || !cookie, "needs E2E_SEEDED=1 and E2E_VERIFIED_COOKIE");
    await context.addCookies([
      { name: "buttercupp_auth", value: cookie, url: "http://localhost:3000" },
    ]);
    await page.route(`${backendUrl}/billing/plans`, async (route) => {
      await route.fulfill({ json: { plans: MOCK_PLANS } });
    });
    await page.route(`${backendUrl}/billing/entitlements`, async (route) => {
      await route.fulfill({ json: FREE_ENTITLEMENTS });
    });
  });

  test("default tab is Subscription; subscriptions render; passes and token packs are hidden", async ({
    page,
  }) => {
    await page.goto("/billing");

    await expect(page.getByTestId("billing-tab-subscription")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("billing-tab-passes")).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await expect(page.getByTestId("subscriptions-section")).toBeVisible();
    await expect(page.getByTestId("plan-sub_monthly")).toBeVisible();
    await expect(page.getByTestId("plan-sub_yearly")).toBeVisible();

    await expect(page.getByTestId("passes-section")).toHaveCount(0);
    await expect(page.getByTestId("plan-cards")).toHaveCount(0);

    await expect(page.getByTestId("token-store")).toHaveCount(0);
  });

  test("clicking Passes shows the pass tiles and hides the subscriptions section", async ({
    page,
  }) => {
    await page.goto("/billing");
    await page.getByTestId("billing-tab-passes").click();

    await expect(page.getByTestId("billing-tab-passes")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("billing-tab-subscription")).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await expect(page.getByTestId("passes-section")).toBeVisible();
    await expect(page.getByTestId("plan-cards")).toBeVisible();
    await expect(page.getByTestId("plan-daily")).toBeVisible();
    await expect(page.getByTestId("plan-weekly")).toBeVisible();
    await expect(page.getByTestId("plan-monthly")).toBeVisible();

    await expect(page.getByTestId("subscriptions-section")).toHaveCount(0);
    await expect(page.getByTestId("plan-sub_monthly")).toHaveCount(0);

    await expect(page.getByTestId("token-store")).toHaveCount(0);
  });

  test("token store test id is absent in both tabs", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByTestId("token-store")).toHaveCount(0);
    await page.getByTestId("billing-tab-passes").click();
    await expect(page.getByTestId("token-store")).toHaveCount(0);
    await page.getByTestId("billing-tab-subscription").click();
    await expect(page.getByTestId("token-store")).toHaveCount(0);
  });
});
