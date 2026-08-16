// Verifies both fixes shipped for the chat page:
//   1. Composer does not overlap the message list (messages render above
//      the composer, not underneath it).
//   2. Persona panel gallery matches the public /characters/[id] gallery:
//      hero visible + first gallery tile visible + rest blurred + locked.
//
// Run: E2E_SEEDED=1 E2E_CHAT_CHARACTER_ID=<id> npm run test:e2e -- chat-fixes

import { test, expect, type Page } from "@playwright/test";

// Extract the underlying media identity from any URL form the app produces
// (raw key, /api/media?k= dev proxy, signed CloudFront). Mirrors
// frontend/lib/character-media.ts::mediaIdentity: two visually-identical
// files under different owner-prefixed S3 keys collide on filename, which
// is exactly the "hero == free gallery tile" bug (byte-identical PNGs at
// distinct keys). Comparing full URL strings (as the previous assertion
// did) missed it.
function identityFromSrc(src: string | null): string {
  if (!src) return "";
  if (src.startsWith("/api/media")) {
    const q = src.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? src.slice(q) : "");
    const k = params.get("k") ?? "";
    const slash = k.lastIndexOf("/");
    return slash >= 0 ? k.slice(slash + 1) : k;
  }
  let path = src;
  const q = src.indexOf("?");
  if (q >= 0) path = src.slice(0, q);
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* fall through */
    }
  }
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

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
    // Hero != free tile: the free teaser must be a different image than the
    // hero above, never a duplicate.
    const heroSrc = await hero.locator("img").getAttribute("src");
    const tile0Src = await tile0.locator("img").first().getAttribute("src");
    expect(heroSrc).toBeTruthy();
    expect(tile0Src).toBeTruthy();
    // Compare by media identity (basename of the underlying S3 key), not
    // by full URL: byte-identical seed PNGs live at different owner-prefixed
    // keys, so full URLs differ while the picture is the same.
    expect(identityFromSrc(tile0Src)).not.toBe(identityFromSrc(heroSrc));
    await page.screenshot({ path: "/tmp/chat-fixes/gallery-chat-desktop.png", fullPage: false });

    await tile0.click();
    await expect(page.getByText(/unlock/i).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`/characters/${characterId}`);
    const pubTile0 = page.getByTestId("character-gallery-tile-0");
    const pubTile1 = page.getByTestId("character-gallery-tile-1");
    await expect(pubTile0).toHaveAttribute("data-locked", "false");
    await expect(pubTile1).toHaveAttribute("data-locked", "true");
    // Hero != free tile on the public detail page too. The hero is the
    // portrait card at the top of the left column; tile 0 sits in the
    // horizontal Photos strip and must not duplicate it.
    const pubHeroSrc = await page.locator("h1").first().locator("xpath=ancestor::div[1]/../..//img").first().getAttribute("src");
    const pubTile0Src = await pubTile0.locator("img").first().getAttribute("src");
    expect(pubHeroSrc).toBeTruthy();
    expect(pubTile0Src).toBeTruthy();
    expect(identityFromSrc(pubTile0Src)).not.toBe(identityFromSrc(pubHeroSrc));
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
    const mobileHero = sheet.getByTestId("persona-panel-hero");
    const mobileHeroSrc = await mobileHero.locator("img").getAttribute("src");
    const mobileTile0Src = await tile0.locator("img").first().getAttribute("src");
    expect(mobileHeroSrc).toBeTruthy();
    expect(mobileTile0Src).toBeTruthy();
    expect(identityFromSrc(mobileTile0Src)).not.toBe(identityFromSrc(mobileHeroSrc));
    await page.screenshot({ path: "/tmp/chat-fixes/gallery-chat-mobile.png", fullPage: false });
  });
});
