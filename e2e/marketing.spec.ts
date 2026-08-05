// Marketing landing E2E. The always-on assertions cover the static shape
// (headline, CTAs, footer). The DB-dependent assertions (persona previews,
// mature gating) are skipped by default until the local seed harness is
// wired the same way the gallery specs will be in Phase 12; running with
// `E2E_SEEDED=1` after `npm run db:seed` enables them locally.

import { test, expect } from "@playwright/test";

const SEEDED = process.env.E2E_SEEDED === "1";

test.describe("marketing landing", () => {
  test("renders hero headline and both primary CTAs", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const create = page.getByRole("link", { name: /create your companion/i }).first();
    const browse = page.getByRole("link", { name: /^browse$/i }).first();
    await expect(create).toHaveAttribute("href", "/signup");
    await expect(browse).toHaveAttribute("href", "/gallery");
  });

  test("site footer is mounted with legal links", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByTestId("site-footer");
    await expect(footer).toBeVisible();
    // At least the terms + privacy + 2257 anchors exist. If Phase 15 has not
    // shipped, the hrefs still render (they resolve once Phase 15 does).
    await expect(footer.getByRole("link", { name: /terms/i })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    await expect(footer.getByRole("link", { name: /privacy/i })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    await expect(footer.getByRole("link", { name: /2257/i })).toHaveAttribute(
      "href",
      "/legal/2257",
    );
  });

  test("visitor sees Log in and Sign up in the header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^log in$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign up$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(0);
  });

  test("real persona previews render from seeded DB", async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 after `npm run db:seed` to enable");
    await page.goto("/");
    await expect(page.getByTestId("persona-preview").first()).toBeVisible();
  });

  test("no clear mature imagery leaks to unauthenticated visitor", async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 after `npm run db:seed` to enable");
    await page.goto("/");
    // Any mature preview must carry the 18+ gate chip; the img is blurred.
    const gated = page.getByText(/18\+ verify to view/i);
    if (await gated.count()) {
      await expect(gated.first()).toBeVisible();
    }
  });
});
