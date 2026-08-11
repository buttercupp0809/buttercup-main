// Phase 19: chat gesture/dialogue formatting E2E.
// Gated behind E2E_SEEDED=1 + E2E_VERIFIED_COOKIE because it needs a
// seeded system character AND a verified-user session cookie to enter chat.

import { test, expect } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";
const cookie = process.env.E2E_VERIFIED_COOKIE ?? "";
const characterId = process.env.E2E_CHARACTER_ID ?? "";

test.describe("chat gestures", () => {
  test.beforeEach(async ({ context }) => {
    test.skip(!seeded || !cookie || !characterId,
      "needs E2E_SEEDED=1, E2E_VERIFIED_COOKIE, and E2E_CHARACTER_ID");
    await context.addCookies([
      { name: "buttercupp_auth", value: cookie, url: "http://localhost:3000" },
    ]);
  });

  test("typing dots -> streamed reply with italic gestures, user stays plain", async ({ page }) => {
    await page.goto(`/chat/${characterId}`);

    // The user types a message with asterisks; those must render PLAIN.
    await page.getByTestId("chat-input").fill("*I wave awkwardly* hi there");
    await page.getByTestId("chat-send").click();

    // The user bubble is present and contains the raw asterisks (no italic span).
    const userBubble = page.getByTestId("bubble-user").last();
    await expect(userBubble).toContainText("*I wave awkwardly* hi there");
    await expect(userBubble.locator(".italic")).toHaveCount(0);

    // Typing dots show while awaiting the first token.
    await expect(page.getByTestId("typing-dots")).toBeVisible({ timeout: 5000 });

    // Once tokens arrive, dots disappear and an assistant bubble streams.
    await expect(page.getByTestId("typing-dots")).toBeHidden({ timeout: 15000 });
    const assistant = page.getByTestId("bubble-assistant").last();
    await expect(assistant).toBeVisible();

    // If the assistant used any `*...*` run, it should be rendered italic.
    // Not all replies will contain a gesture, so allow zero-or-more; but
    // when present, they must be `.italic`.
    const gestures = assistant.locator('[data-testid="gesture"]');
    const count = await gestures.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(gestures.nth(i)).toHaveClass(/italic/);
      }
    }
  });
});
