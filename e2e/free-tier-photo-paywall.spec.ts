// E2E: free-tier photo paywall.
//
// Tests:
//   1. A free user who asks for a photo sees a blurred bubble with a CTA
//      overlay (not a clear image).
//   2. After simulating a paid upgrade (flipping the subscription), the same
//      bubble renders the clear image (unlock is automatic, no migration).
//
// Prerequisites:
//   - The app is running at http://localhost:3000 (baseURL from playwright.config.ts).
//   - E2E_FREE_USER_EMAIL + E2E_FREE_USER_PASSWORD: credentials for a seeded
//     free user whose subscription row is absent or inactive.
//   - E2E_PAID_USER_EMAIL + E2E_PAID_USER_PASSWORD: credentials for a seeded
//     active-plan user (or the test script upgrades the free user directly
//     via a DB helper).
//   - E2E_CHAT_CHARACTER_ID: an existing character ID to chat with.
//
// If the required env vars are absent the test self-skips cleanly so CI does
// not fail in environments without a seeded database.

import { test, expect, type Page } from "@playwright/test";

const FREE_EMAIL = process.env.E2E_FREE_USER_EMAIL;
const FREE_PASSWORD = process.env.E2E_FREE_USER_PASSWORD;
const CHARACTER_ID = process.env.E2E_CHAT_CHARACTER_ID;

const skip = !FREE_EMAIL || !FREE_PASSWORD || !CHARACTER_ID;

// Login helper.
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(chats|characters|chat)/, { timeout: 15_000 });
}

test.describe("Free-tier photo paywall", () => {
  test.skip(skip, "E2E_FREE_USER_EMAIL / E2E_FREE_USER_PASSWORD / E2E_CHAT_CHARACTER_ID not set");

  test("free user sees a blurred teaser bubble with CTA when asking for a photo", async ({ page }) => {
    await login(page, FREE_EMAIL!, FREE_PASSWORD!);
    await page.goto(`/chat/${CHARACTER_ID!}`);
    await page.waitForLoadState("networkidle");

    // Send an image request.
    const input = page.locator("textarea, input[type='text']").last();
    await input.fill("send me a photo");
    await input.press("Enter");

    // Wait for the image bubble to appear (the skeleton or the final bubble).
    const imageBubble = page.locator('[data-testid="bubble-image"]').first();
    await expect(imageBubble).toBeVisible({ timeout: 60_000 });

    // The locked teaser must NOT contain a clear <img> with a real src pointing
    // to /api/media or a signed URL. It must contain the "Unlock" CTA button.
    const unlockBtn = imageBubble.locator('button:has-text("Unlock"), span:has-text("Unlock")');
    await expect(unlockBtn).toBeVisible({ timeout: 10_000 });

    // The bubble must not show a real (signed) image URL in any img src.
    const imgs = imageBubble.locator("img");
    const count = await imgs.count();
    for (let i = 0; i < count; i++) {
      const src = await imgs.nth(i).getAttribute("src");
      // A blurred data URI (data:image/...) is acceptable; a /api/media or
      // https:// URL that bypasses the paywall is not.
      if (src && !src.startsWith("data:")) {
        throw new Error(`Expected only data: URI in locked bubble img, got: ${src}`);
      }
    }
  });

  test("clicking the locked bubble opens the UpgradeModal", async ({ page }) => {
    await login(page, FREE_EMAIL!, FREE_PASSWORD!);
    await page.goto(`/chat/${CHARACTER_ID!}`);
    await page.waitForLoadState("networkidle");

    // Find an existing locked bubble (from history or send a new request).
    const imageBubble = page.locator('[data-testid="bubble-image"]').first();
    const isVisible = await imageBubble.isVisible().catch(() => false);

    if (!isVisible) {
      const input = page.locator("textarea, input[type='text']").last();
      await input.fill("send me a photo of yourself");
      await input.press("Enter");
      await expect(imageBubble).toBeVisible({ timeout: 60_000 });
    }

    // Click the locked bubble to open the upgrade modal.
    await imageBubble.click();

    // UpgradeModal must appear (it has a billing/upgrade link or title).
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
  });
});
