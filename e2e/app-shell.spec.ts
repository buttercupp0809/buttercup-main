// App-shell E2E: the persistent left sidebar, mobile drawer + bottom bar,
// AI-disclosure presence on every protected surface, and logout from both
// entry points. The full flow assertions (routing, logout redirect) require
// a seeded verified user and are gated on E2E_SEEDED=1; the smoke checks
// (redirect from a protected route to /login when unauthenticated) run
// unconditionally so this spec catches most regressions in CI.

import { test, expect } from "@playwright/test";

const SEEDED = process.env.E2E_SEEDED === "1";

test.describe("app shell (unauthenticated)", () => {
  test("hitting /dashboard while logged out redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(login|age-gate)/);
  });

  test("hitting /chats while logged out redirects", async ({ page }) => {
    await page.goto("/chats");
    await expect(page).toHaveURL(/\/(login|age-gate)/);
  });
});

test.describe("app shell (seeded verified user)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 and provide a seeded verified test user");
    // Login helper: mirrors the pattern used by auth-age-gate.spec.ts when
    // that harness lands. Adjust these to whatever env-based creds the seed
    // script exposes.
    const email = process.env.E2E_USER_EMAIL ?? "test@buttercupp.local";
    const password = process.env.E2E_USER_PASSWORD ?? "TestPassword-1!";
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test("sidebar routes to Discover, Create, Settings, Chats", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("nav-discover").click();
    await expect(page).toHaveURL(/\/gallery/);
    await page.getByTestId("nav-create").click();
    await expect(page).toHaveURL(/\/create/);
    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByTestId("nav-chats").click();
    await expect(page).toHaveURL(/\/chats/);
  });

  test("AI disclosure is visible on every protected surface", async ({ page }) => {
    for (const path of ["/dashboard", "/gallery", "/create", "/settings", "/chats"]) {
      await page.goto(path);
      await expect(page.getByTestId("ai-disclosure").first()).toBeVisible();
    }
  });

  test("dashboard shows Create CTA and feed sections", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("create-cta")).toBeVisible();
    for (const key of ["for-you", "new-this-week", "trending", "popular"]) {
      await expect(page.getByTestId(`feed-${key}`)).toBeVisible();
    }
  });

  test("logout from profile menu returns to landing and clears cookie", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("profile-menu-trigger").click();
    await page.getByTestId("logout-button").click();
    await page.waitForURL(/\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(login|age-gate)/);
  });

  test("logout from settings returns to landing", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-logout").click();
    await page.waitForURL(/\/$/);
  });

  test("mobile drawer opens and desktop sidebar is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("nav-discover")).toBeHidden();
    await page.getByTestId("mobile-nav-trigger").click();
    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();
    await drawer.getByTestId("nav-discover-mobile").click();
    await expect(page).toHaveURL(/\/gallery/);
  });
});
