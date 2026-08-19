// Phase 29: first-login consent modal.
//
// The unauthenticated smoke check runs unconditionally. The full
// accept/decline/version-bump flows need a user whose acceptedPolicyVersion
// is null, which is true of every brand new signup (signup captures its own
// legacy tosAcceptedAt/privacyAcceptedAt fields but never touches
// acceptedPolicyVersion, see frontend/app/api/auth/signup/route.ts and
// frontend/lib/consent.ts). Earlier this used the shared
// test@buttercupp.local fixture (the same account app-shell.spec.ts,
// image-swap.spec.ts, and mobile-responsive.spec.ts log into expecting it to
// already be a fully onboarded, consented user), which meant this spec and
// those specs each required contradictory persisted state on the very same
// row: whichever spec ran first in a full suite run would flip
// acceptedPolicyVersion out from under the other, so at most one side of
// that fixture conflict could ever pass. Signing up a fresh, unique user per
// test removes the shared mutable fixture entirely: every test gets
// naturally, deterministically unconsented state with no DB reset needed
// and no risk of colliding with any other spec.

import { test, expect, type Page } from "@playwright/test";

const SEEDED = process.env.E2E_SEEDED === "1";

function uniqueEmail(): string {
  return `consent-modal-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

async function signupFreshUser(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill("Correct-horse4Battery");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

test.describe("consent modal (unauthenticated)", () => {
  test("direct navigation to a protected route without a session redirects to /login, not the modal", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(login|age-gate)/);
  });
});

test.describe("consent modal (seeded, unconsented user)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 to run against a live seeded stack");
    await signupFreshUser(page);
  });

  test("first login (acceptedPolicyVersion null) blocks the app with the consent modal", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("consent-modal")).toBeVisible();
  });

  test("direct-URL bypass to /chats or /create still shows the modal, not the feature", async ({
    page,
  }) => {
    for (const path of ["/chats", "/create"]) {
      await page.goto(path);
      await expect(page.getByTestId("consent-modal")).toBeVisible();
    }
  });

  test("decline logs out: session ends and re-visiting /dashboard redirects to /login", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("consent-modal")).toBeVisible();
    await page.getByTestId("consent-decline").click();
    await page.waitForURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a single Agree action enters the app and does not reshow on reload", async ({
    page,
  }) => {
    // Phase: single-action consent redesign. The modal no longer gates
    // Accept behind three checkboxes; one "I Agree" tap sends all three
    // consent fields (tosAccepted, privacyAccepted, ageConfirmed) as true
    // together, and the server DTO (ConsentAcceptDto) still enforces all
    // three as z.literal(true) independently. This spec only exercises the
    // client interaction model, not the server strictness (covered by
    // frontend/app/api/consent/accept/route.test.ts).
    await page.goto("/dashboard");
    const modal = page.getByTestId("consent-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByTestId("consent-accept")).toBeEnabled();
    await page.getByTestId("consent-accept").click();
    await expect(modal).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("consent-modal")).toBeHidden();
  });

  test.skip("version bump reshows the modal exactly once (requires manual acceptedPolicyVersion edit)", async () => {
    // Needs a harness hook to set acceptedPolicyVersion to a stale value
    // between the two navigations; not wired yet.
  });
});
