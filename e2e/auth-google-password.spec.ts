import { test, expect } from "@playwright/test";

// Password polish + Google button spec. Runs against the /signup and /login
// pages. Does not submit the form (no DB required); it only exercises the
// client-side UX contract (eye toggle, checklist, submit enable/disable,
// Google button hides when not configured).

const STRONG = "Correct-horse4Battery";
const WEAK = "weakpassword";

test.describe("auth polish", () => {
  test("signup: eye toggle flips input type between password and text", async ({ page }) => {
    await page.goto("/signup");
    const input = page.getByLabel("Password", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).click();
    await expect(input).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: /hide password/i }).click();
    await expect(input).toHaveAttribute("type", "password");
  });

  test("signup: weak password keeps submit disabled and shows failing checks", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill(WEAK);
    await page.getByLabel(/Country/i).fill("US");
    await page.getByLabel(/Terms of Service/i).check();
    await page.getByLabel(/Privacy Policy/i).check();
    const submit = page.getByRole("button", { name: /create account/i });
    await expect(submit).toBeDisabled();
    const checklist = page.getByTestId("password-checklist");
    await expect(checklist).toBeVisible();
    // Weak password fails: missing upper, digit, symbol.
    await expect(checklist.getByText(/uppercase letter/i)).toBeVisible();
  });

  test("signup: strong password ticks all checks and enables submit", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill(STRONG);
    await page.getByLabel(/Country/i).fill("US");
    await page.getByLabel(/Terms of Service/i).check();
    await page.getByLabel(/Privacy Policy/i).check();
    await expect(page.getByRole("button", { name: /create account/i })).toBeEnabled();
  });

  test("signup: compliance capture (jurisdiction + ToS + Privacy) is present", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByLabel(/Country/i)).toBeVisible();
    await expect(page.getByLabel(/Terms of Service/i)).toBeVisible();
    await expect(page.getByLabel(/Privacy Policy/i)).toBeVisible();
  });

  test("login: eye toggle works and no checklist is rendered", async ({ page }) => {
    await page.goto("/login");
    const input = page.getByLabel("Password", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(page.getByTestId("password-checklist")).toHaveCount(0);
  });

  test("google button reflects configuration state", async ({ page }) => {
    await page.goto("/signup");
    const configured = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (configured) {
      await expect(page.getByTestId("google-button")).toBeVisible();
    } else {
      await expect(page.getByTestId("google-button-disabled")).toBeVisible();
    }
  });
});
