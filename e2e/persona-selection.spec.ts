// Persona selection (Phase 18). Verifies the immersive detail page and the
// "Start chat" flow for eligible viewers. Gated behind E2E_SEEDED=1 so it
// only runs against a locally seeded stack.

import { test, expect } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";

test.describe("persona selection", () => {
  test("image-forward cards render with name overlay", async ({ page }) => {
    test.skip(!seeded, "needs seeded DB (set E2E_SEEDED=1)");
    await page.goto("/gallery");
    const card = page.getByTestId("character-card").first();
    await expect(card).toBeVisible();
    // Card is a link into the detail route.
    await expect(card).toHaveAttribute("href", /\/characters\//);
  });

  test("verified user can Start chat and lands on chat surface", async ({ page }) => {
    test.skip(
      !seeded || !process.env.E2E_VERIFIED_COOKIE,
      "needs seeded DB + a verified-user session cookie (E2E_VERIFIED_COOKIE)",
    );
    await page.context().addCookies([
      {
        name: "buttercupp_auth",
        value: process.env.E2E_VERIFIED_COOKIE!,
        url: "http://localhost:3000",
      },
    ]);
    await page.goto("/gallery");
    await page.getByTestId("character-card").first().click();
    const cta = page.getByTestId("chat-cta");
    await expect(cta).toHaveAttribute("data-cta-state", "eligible");
    await page.getByTestId("start-chat").click();
    await expect(page).toHaveURL(/\/chat\//);
  });
});
