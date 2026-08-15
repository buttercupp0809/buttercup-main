// Phase 25 mobile-responsive E2E. The public-route overflow assertions run
// unconditionally (no horizontal scroll is the single most important mobile
// bug). Everything that needs an authenticated session is gated behind
// E2E_SEEDED=1 (+ login), mirroring app-shell.spec.ts; the chat-pane cases
// additionally need E2E_VERIFIED_COOKIE and E2E_CHARACTER_ID, mirroring
// chat-gestures.spec.ts exactly.

import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "parallel" });

const SEEDED = process.env.E2E_SEEDED === "1";
const VERIFIED_COOKIE = process.env.E2E_VERIFIED_COOKIE ?? "";
const CHARACTER_ID = process.env.E2E_CHARACTER_ID ?? "";

const IPHONE_SE = { width: 375, height: 667 };
const IPHONE_14 = { width: 390, height: 844 };
const PIXEL_7 = { width: 412, height: 915 };
// Matches Playwright's built-in devices["iPad Mini"] viewport (also used by
// the "iPad mini" project in playwright.config.ts) and Tailwind's default
// md breakpoint (768px), which is exactly what SideNav's `md:flex` gate is
// keyed on.
const IPAD_MINI = { width: 768, height: 1024 };
const DESKTOP_XL = { width: 1280, height: 900 };

async function login(page: Page) {
  const email = process.env.E2E_USER_EMAIL ?? "test@buttercupp.local";
  const password = process.env.E2E_USER_PASSWORD ?? "TestPassword-1!";
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function boundingBoxOrThrow(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`no bounding box for [data-testid=${testId}]`);
  return box;
}

test.describe("mobile responsive: no horizontal overflow (public, unconditional)", () => {
  for (const [label, viewport] of [
    ["iPhone SE", IPHONE_SE],
    ["Pixel 7", PIXEL_7],
  ] as const) {
    test(`landing has no horizontal scroll at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    });

    test(`gallery has no horizontal scroll at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/gallery");
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    });
  }
});

test.describe("mobile responsive: app shell (seeded verified user)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 and provide a seeded verified test user");
    await page.setViewportSize(IPHONE_14);
    await login(page);
  });

  test("bottom bar is visible and clears the safe area on mobile", async ({ page }) => {
    await page.goto("/dashboard");
    const bar = page.getByTestId("bottom-chats");
    await expect(bar).toBeVisible();
    const box = await boundingBoxOrThrow(page, "bottom-chats");
    const viewport = page.viewportSize();
    expect(box.y + box.height).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  });

  test("mobile nav drawer opens, traps focus on the first link, and closes on Escape", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("mobile-nav-trigger").click();
    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();

    // Focus trap smoke check: the first drawer link receives focus on open.
    const firstLink = drawer.locator("a").first();
    await expect(firstLink).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("tap targets are at least 44x44 for the nav trigger and a bottom bar link", async ({ page }) => {
    await page.goto("/dashboard");
    for (const testId of ["mobile-nav-trigger", "bottom-chats"]) {
      const box = await boundingBoxOrThrow(page, testId);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("dashboard recents strip is scroll-snap wired when present", async ({ page }) => {
    await page.goto("/dashboard");
    const strip = page.getByTestId("dashboard-recents-strip");
    if (await strip.count()) {
      const snapType = await strip.evaluate((el) => getComputedStyle(el).scrollSnapType);
      expect(snapType).not.toBe("none");
    }
  });
});

test.describe("mobile responsive: tablet shows SideNav, not the bottom bar (seeded)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 and provide a seeded verified test user");
    await page.setViewportSize(IPAD_MINI);
    await login(page);
  });

  test("iPad mini (md) shows the SideNav and hides the mobile bottom bar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("nav-discover")).toBeVisible();
    await expect(page.getByTestId("bottom-chats")).toBeHidden();
  });
});

test.describe("mobile responsive: chat panes (seeded + verified cookie)", () => {
  test.beforeEach(async ({ context }) => {
    test.skip(
      !SEEDED || !VERIFIED_COOKIE || !CHARACTER_ID,
      "needs E2E_SEEDED=1, E2E_VERIFIED_COOKIE, and E2E_CHARACTER_ID",
    );
    await context.addCookies([
      { name: "buttercupp_auth", value: VERIFIED_COOKIE, url: "http://localhost:3000" },
    ]);
  });

  test("chat-send tap target is at least 44x44 on mobile", async ({ page }) => {
    await page.setViewportSize(IPHONE_14);
    await page.goto(`/chat/${CHARACTER_ID}`);
    const box = await boundingBoxOrThrow(page, "chat-send");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("ChatList and PersonaPanel are reachable via PanelSheet below their inline breakpoints", async ({ page }) => {
    await page.setViewportSize(IPHONE_14);
    await page.goto(`/chat/${CHARACTER_ID}`);

    await page.getByTestId("chatlist-trigger").click();
    const listSheet = page.getByTestId("panel-sheet");
    await expect(listSheet).toBeVisible();
    await expect(listSheet.getByPlaceholder(/search for a profile/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listSheet).toBeHidden();

    await page.getByTestId("persona-trigger").click();
    const personaSheet = page.getByTestId("panel-sheet");
    await expect(personaSheet).toBeVisible();
    await expect(personaSheet.getByRole("heading", { level: 2 })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(personaSheet).toBeHidden();
  });

  test("inline ChatList/PersonaPanel render and the triggers hide at lg/xl", async ({ page }) => {
    await page.setViewportSize(DESKTOP_XL);
    await page.goto(`/chat/${CHARACTER_ID}`);
    await expect(page.getByTestId("chatlist-trigger")).toBeHidden();
    await expect(page.getByTestId("persona-trigger")).toBeHidden();
  });

  test("chat composer stays pinned within the viewport when the input is focused", async ({ page }) => {
    await page.setViewportSize(IPHONE_14);
    await page.goto(`/chat/${CHARACTER_ID}`);
    const input = page.getByTestId("chat-input");
    await input.focus();
    const form = page.locator("form", { has: input });
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(box!.y + box!.height).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  });
});

test.describe("mobile responsive: reels feed snap (seeded)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SEEDED, "set E2E_SEEDED=1 and provide a seeded verified test user");
    await page.setViewportSize(IPHONE_14);
    await login(page);
  });

  test("reel scroller has vertical scroll-snap wired", async ({ page }) => {
    await page.goto("/reels");
    const scroller = page.getByTestId("reel-scroller");
    await expect(scroller).toBeVisible();
    const snapType = await scroller.evaluate((el) => getComputedStyle(el).scrollSnapType);
    expect(snapType).not.toBe("none");
  });
});
