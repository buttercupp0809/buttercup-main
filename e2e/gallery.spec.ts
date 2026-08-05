// Gallery E2E. All specs assume a locally seeded DB (system characters).
// They are gated behind `E2E_SEEDED=1` so CI without a seeded DB still
// passes; run locally with `E2E_SEEDED=1 npm run test:e2e -- gallery`.

import { test, expect } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";

test.describe("gallery (visitor)", () => {
  test("sees seeded system character cards", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    await expect(page.getByTestId("character-card").first()).toBeVisible();
  });

  test("segmented sort control drives URL", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    await page.getByTestId("sort-new").click();
    await expect(page).toHaveURL(/sort=new/);
    await page.getByTestId("sort-trending").click();
    await expect(page).toHaveURL(/sort=trending/);
  });

  test("style filter + search push URL query", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    await page.getByTestId("filter-style").selectOption("realistic");
    await expect(page).toHaveURL(/style=realistic/);
    await page.getByTestId("search-input").fill("aria");
    await expect(page).toHaveURL(/q=aria/);
  });

  test("mature rating filter is hidden for unverified viewers", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    await expect(page.getByTestId("filter-rating")).toHaveCount(0);
  });

  test("detail CTA prompts signup and does not enter chat", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    await page.getByTestId("character-card").first().click();
    const cta = page.getByTestId("chat-cta");
    await expect(cta).toHaveAttribute("data-cta-state", "visitor");
    await cta.getByRole("link", { name: /sign up to chat/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});
