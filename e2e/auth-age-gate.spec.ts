// E2E scaffolding. These specs describe the intended flows called out by
// Plans/cursor-prompt/01-auth-age-gate.md. They are stubs today so the test
// harness has something to run and later phases can flesh out.

import { test, expect } from "@playwright/test";

test.describe("auth + age gate", () => {
  test("unverified user is redirected from /chat to /age-gate", async ({ page }) => {
    test.skip(true, "wire once signup UI + test DB reset harness are in place");
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/age-gate/);
  });

  test("under-18 dob is rejected on the age gate", async ({ page }) => {
    test.skip(true, "wire once auth harness is in place");
    await page.goto("/age-gate");
  });

  test("verified user reaches /dashboard", async ({ page }) => {
    test.skip(true, "wire once auth harness is in place");
    await page.goto("/dashboard");
    await expect(page.getByTestId("profile-menu-trigger").first()).toBeVisible();
  });
});
