// Phase 26: the free/isDisplay image (not the isPrimary hero) must be the
// clear image shown everywhere; the hero must stay a blurred locked tile and
// its real URL must never appear as a clear <img src> anywhere.
//
// Requires a local dev server + local seeded DB with at least one character
// that has TWO images: an isPrimary hero (should stay locked) and an
// isDisplay secondary (should render everywhere as the clear avatar/card).
// The stock seed only creates one image per persona (see seed.ts), so this
// spec expects the fixture to be prepared manually, e.g. per the plan's
// MANUAL test instructions:
//   1. npm run seed -w @buttercupp/database
//   2. insert a second image row for one character (the original stays
//      isPrimary = true; the new row is the free/secondary asset)
//   3. npm run backfill:display -w @buttercupp/database
//   4. export E2E_IMAGE_SWAP_CHARACTER_ID=<that character's id>
//
// Run: E2E_SEEDED=1 E2E_IMAGE_SWAP_CHARACTER_ID=<id> npm run test:e2e -- image-swap

import { test, expect, type Page } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";
const characterId = process.env.E2E_IMAGE_SWAP_CHARACTER_ID;
const canRun = seeded && Boolean(characterId);

// GET /api/characters/[id] sits behind the auth-cookie check in
// middleware.ts (it is not in PUBLIC_API_PREFIXES), so a real logged-in
// session is required before calling the API. Note this uses page.request,
// not the standalone `request` fixture: the standalone fixture is its own
// APIRequestContext with its own cookie jar and does NOT see cookies set via
// page.goto/UI login, while page.request shares the browser context (and
// therefore the auth cookie) with `page`.
async function login(page: Page) {
  const email = process.env.E2E_USER_EMAIL ?? "test@buttercupp.local";
  const password = process.env.E2E_USER_PASSWORD ?? "TestPassword-1!";
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

test.describe("image swap: free/display asset is shown, hero stays paywalled", () => {
  test("gallery card shows the free image, not the hero", async ({ page }) => {
    test.skip(!canRun, "needs a seeded DB with a two-image character; set E2E_SEEDED=1 and E2E_IMAGE_SWAP_CHARACTER_ID");
    await login(page);
    const detail = await (await page.request.get(`/api/characters/${characterId}`)).json();
    const displayUrl: string = detail.avatarUrl;

    await page.goto("/gallery");
    const card = page.getByTestId("character-card").filter({ has: page.locator(`img[src="${displayUrl}"]`) });
    await expect(card).toHaveCount(1);
  });

  test("landing card shows the free image, not the hero", async ({ page }) => {
    test.skip(!canRun, "needs a seeded DB with a two-image character; set E2E_SEEDED=1 and E2E_IMAGE_SWAP_CHARACTER_ID");
    await login(page);
    const detail = await (await page.request.get(`/api/characters/${characterId}`)).json();
    const displayUrl: string = detail.avatarUrl;

    await page.goto("/");
    await expect(page.locator(`img[src="${displayUrl}"]`).first()).toBeVisible();
  });

  test("chat header avatar and chat-top image show the free image", async ({ page }) => {
    test.skip(!canRun, "needs a seeded DB with a two-image character; set E2E_SEEDED=1 and E2E_IMAGE_SWAP_CHARACTER_ID");
    await login(page);
    const detail = await (await page.request.get(`/api/characters/${characterId}`)).json();
    const displayUrl: string = detail.avatarUrl;

    await page.goto(`/chat/${characterId}`);
    await expect(page.locator(`img[src="${displayUrl}"]`).first()).toBeVisible();
  });

  test("gallery tiles beyond the first are blurred locked tiles; their real URLs never leak", async ({
    page,
  }) => {
    test.skip(!canRun, "needs a seeded DB with a two-image character; set E2E_SEEDED=1 and E2E_IMAGE_SWAP_CHARACTER_ID");
    await login(page);
    const detail = await (await page.request.get(`/api/characters/${characterId}`)).json();
    // galleryImages[0] is the free teaser (matches the public detail page);
    // every gallery URL beyond it must stay behind the paywall and never
    // reach the DOM as a clear <img src>.
    const lockedUrls: string[] = (detail.galleryImages ?? []).slice(1);

    await page.goto(`/chat/${characterId}`);
    for (const url of lockedUrls) {
      await expect(page.locator(`img[src="${url}"]`)).toHaveCount(0);
    }

    // Clicking a locked gallery tile opens the upgrade modal without leaking
    // any locked URL (the modal renders with no imageSrc for locked tiles).
    const unlockButton = page.getByLabel("Unlock premium content").first();
    if (await unlockButton.count()) {
      await unlockButton.click();
      await expect(page.getByText(/unlock/i)).toBeVisible();
      for (const url of lockedUrls) {
        await expect(page.locator(`img[src="${url}"]`)).toHaveCount(0);
      }
    }
  });

  // Restored product requirement: even the ONE free/display preview at the
  // top of the persona panel is a teaser, not a full free view. Clicking it
  // must open the same upgrade modal every locked gallery tile opens.
  test("clicking the free/display preview image also opens the upgrade modal", async ({ page }) => {
    test.skip(!canRun, "needs a seeded DB with a two-image character; set E2E_SEEDED=1 and E2E_IMAGE_SWAP_CHARACTER_ID");
    await login(page);
    const detail = await (await page.request.get(`/api/characters/${characterId}`)).json();
    const displayUrl: string = detail.avatarUrl;

    await page.goto(`/chat/${characterId}`);
    // Scoped to the persona-panel hero tile specifically: the chat header
    // and background scrim also render the same avatarUrl as a plain <img>
    // with no click handler, so a bare `img[src=...]` locator would resolve
    // ambiguously (and even if `.first()` happened to work, it would not be
    // testing the tile this test cares about).
    const freePreview = page.getByTestId("persona-panel-hero");
    await expect(freePreview).toBeVisible();
    await freePreview.click();
    await expect(page.getByText(/unlock/i)).toBeVisible();
  });
});
