// Magical onboarding (Phase 24). Full new-user flow: signup -> age-gate ->
// onboarding -> dashboard. Runs against a live dev server + local DB, so it
// is not part of the default fast suite; see Plans/cursor-prompt/24-magical-onboarding.md
// "Test instructions" for how to run it (`npm run test:e2e -- onboarding`).

import { test, expect } from "@playwright/test";

function uniqueEmail(): string {
  return `onboarding-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

test.describe("magical onboarding", () => {
  test("new user is guided through onboarding once, before the dashboard", async ({ page }) => {
    const email = uniqueEmail();
    const displayName = "Story";

    // --- Signup ---------------------------------------------------------
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Correct-horse4Battery");
    await page.getByRole("button", { name: /create account/i }).click();

    // --- Age gate ---------------------------------------------------------
    await expect(page).toHaveURL(/\/(age-gate|dashboard|onboarding)/);
    if (/age-gate/.test(page.url())) {
      await page.getByLabel(/Date of birth/i).fill("1995-05-05");
      await page.getByLabel(/Country/i).fill("US");
      await page.getByLabel(/Terms of Service/i).check();
      await page.getByLabel(/Privacy Policy/i).check();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    // --- First-login consent modal (Phase 29) sits between signup and
    // onboarding for every fresh account: acceptedPolicyVersion is null
    // until explicitly accepted here, regardless of the signup-time
    // checkboxes. See frontend/lib/consent.ts / e2e/consent-modal.spec.ts.
    const consentModal = page.getByTestId("consent-modal");
    const consentModalShown = await consentModal
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (consentModalShown) {
      // Single-action consent redesign: one "I Agree" tap sends all three
      // consent fields together, no checkboxes to check first.
      await page.getByTestId("consent-accept").click();
      await expect(consentModal).toBeHidden();
    }

    // --- Land on onboarding, not the dashboard ---------------------------
    await expect(page).toHaveURL(/\/onboarding\/identity/);

    // --- Step 1: identity --------------------------------------------------
    await page.getByTestId("onboarding-display-name").fill(displayName);
    await page.getByTestId("onboarding-gender-nonbinary").click();
    await page.getByTestId("onboarding-continue").click();

    // --- Step 2: taste -------------------------------------------------
    await expect(page).toHaveURL(/\/onboarding\/taste/);
    await page.getByTestId("onboarding-vibe-cozy").click();
    await page.getByTestId("onboarding-interest-Music").click();
    await page.getByTestId("onboarding-interest-Travel").click();
    await page.getByTestId("onboarding-continue").click();

    // --- Step 3: optional pick (skip) -----------------------------------
    await expect(page).toHaveURL(/\/onboarding\/pick/);
    await page.getByTestId("onboarding-skip").click();

    // --- Step 4: finish --------------------------------------------------
    await expect(page).toHaveURL(/\/onboarding\/finish/);
    await expect(page.getByText(new RegExp(`Welcome, ${displayName}`))).toBeVisible();
    await page.getByTestId("onboarding-finish").click();

    // --- Lands on the dashboard, greeted by display name -----------------
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: new RegExp(`Welcome back, ${displayName}`) })).toBeVisible();

    // --- Once-only gate: reloading /onboarding bounces back to /dashboard -
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("picking a companion in step 3 routes to that companion's chat", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Correct-horse4Battery");
    await page.getByRole("button", { name: /create account/i }).click();

    if (/age-gate/.test(page.url())) {
      await page.getByLabel(/Date of birth/i).fill("1995-05-05");
      await page.getByLabel(/Country/i).fill("US");
      await page.getByLabel(/Terms of Service/i).check();
      await page.getByLabel(/Privacy Policy/i).check();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    // First-login consent modal (Phase 29), see note above.
    const consentModal = page.getByTestId("consent-modal");
    const consentModalShown = await consentModal
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (consentModalShown) {
      await page.getByTestId("consent-accept").click();
      await expect(consentModal).toBeHidden();
    }

    await expect(page).toHaveURL(/\/onboarding\/identity/);
    await page.getByTestId("onboarding-display-name").fill("Nova");
    await page.getByTestId("onboarding-gender-woman").click();
    await page.getByTestId("onboarding-continue").click();

    await page.getByTestId("onboarding-vibe-adventurous").click();
    await page.getByTestId("onboarding-interest-Gaming").click();
    await page.getByTestId("onboarding-continue").click();

    await expect(page).toHaveURL(/\/onboarding\/pick/);
    const card = page.getByTestId("onboarding-pick-card").first();
    test.skip((await card.count()) === 0, "needs a seeded gallery for a real pick");
    await card.click();
    await page.getByTestId("onboarding-continue").click();

    await expect(page).toHaveURL(/\/onboarding\/finish/);
    await page.getByTestId("onboarding-finish").click();
    await expect(page).toHaveURL(/\/chat\//);
  });
});
