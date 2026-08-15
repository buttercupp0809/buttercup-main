// Verifies both fixes shipped for the chat page:
//   1. Composer does not overlap the message list (messages render above
//      the composer, not underneath it).
//   2. Persona panel gallery matches the public /characters/[id] gallery:
//      hero visible + first gallery tile visible + rest blurred + locked.
//
// Run: E2E_SEEDED=1 E2E_CHAT_CHARACTER_ID=<id> npm run test:e2e -- chat-fixes

import { test, expect, type Page } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";
const characterId = process.env.E2E_CHAT_CHARACTER_ID;
const canRun = seeded && Boolean(characterId);

async function login(page: Page) {
  const email = process.env.E2E_USER_EMAIL ?? "test@buttercupp.local";
  const password = process.env.E2E_USER_PASSWORD ?? "TestPassword-1!";
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding|chats|$)/);
}

test.describe("chat page fixes", () => {
  async function assertNoComposerOverlap(page: Page, screenshotPath: string) {
    // Layout-only invariant: the scrolling message list's visible bottom edge
    // must sit at-or-above the composer's top edge, regardless of how many
    // messages exist. Works even when the test account has already hit a
    // paywall (composer input becomes disabled but the geometry is what we
    // care about).
    const scrollArea = page
      .locator("form")
      .filter({ has: page.getByTestId("chat-input") })
      .locator("xpath=preceding-sibling::div[1]");
    const composer = page.locator("form").filter({ has: page.getByTestId("chat-input") });
    const listBox = await scrollArea.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(listBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }

  test("desktop: composer never overlaps the message list", async ({ page }) => {
    test.skip(!canRun, "set E2E_SEEDED=1 and E2E_CHAT_CHARACTER_ID");
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`/chat/${characterId}`);
    await page.waitForSelector("[data-testid=chat-input]");
    await assertNoComposerOverlap(page, "/tmp/chat-fixes/composer-desktop.png");
  });

  test("mobile: composer never overlaps the message list", async ({ page }) => {
    test.skip(!canRun, "set E2E_SEEDED=1 and E2E_CHAT_CHARACTER_ID");
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/chat/${characterId}`);
    await page.waitForSelector("[data-testid=chat-input]");
    await assertNoComposerOverlap(page, "/tmp/chat-fixes/composer-mobile.png");
  });

  test("desktop: chat persona panel gallery matches public detail free-tile logic", async ({ page }) => {
    test.skip(!canRun, "set E2E_SEEDED=1 and E2E_CHAT_CHARACTER_ID");
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await page.goto(`/chat/${characterId}`);
    const hero = page.getByTestId("persona-panel-hero");
    await expect(hero).toBeVisible();

    const tile0 = page.getByTestId("chat-persona-gallery-tile-0");
    const tile1 = page.getByTestId("chat-persona-gallery-tile-1");
    await expect(tile0).toHaveAttribute("data-locked", "false");
    await expect(tile1).toHaveAttribute("data-locked", "true");
    await page.screenshot({ path: "/tmp/chat-fixes/gallery-chat-desktop.png", fullPage: false });

    await tile0.click();
    await expect(page.getByText(/unlock/i).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`/characters/${characterId}`);
    const pubTile0 = page.getByTestId("character-gallery-tile-0");
    const pubTile1 = page.getByTestId("character-gallery-tile-1");
    await expect(pubTile0).toHaveAttribute("data-locked", "false");
    await expect(pubTile1).toHaveAttribute("data-locked", "true");
    await page.screenshot({ path: "/tmp/chat-fixes/gallery-public-desktop.png", fullPage: false });
  });

  test("mobile: chat persona panel sheet gallery matches free-tile logic", async ({ page }) => {
    test.skip(!canRun, "set E2E_SEEDED=1 and E2E_CHAT_CHARACTER_ID");
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/chat/${characterId}`);
    await page.getByTestId("persona-trigger").click();

    const sheet = page.getByTestId("panel-sheet");
    const tile0 = sheet.getByTestId("chat-persona-gallery-tile-0");
    const tile1 = sheet.getByTestId("chat-persona-gallery-tile-1");
    await expect(tile0).toBeVisible();
    await expect(tile0).toHaveAttribute("data-locked", "false");
    await expect(tile1).toHaveAttribute("data-locked", "true");
    await page.screenshot({ path: "/tmp/chat-fixes/gallery-chat-mobile.png", fullPage: false });
  });
});
