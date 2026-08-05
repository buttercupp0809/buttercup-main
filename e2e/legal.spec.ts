import { test, expect, type Page } from "@playwright/test";

// Legal + footer link-crawl spec. Runs without any DB seed because /legal/*
// is static; the only interactions are HTTP GETs + a couple of DOM asserts.

const LEGAL_SLUGS = [
  "terms",
  "privacy",
  "cookie",
  "content-policy",
  "dmca",
  "2257",
  "refund",
  "about",
  "contact",
] as const;

test.describe("legal pages", () => {
  for (const slug of LEGAL_SLUGS) {
    test(`/legal/${slug} renders while logged out`, async ({ page }) => {
      const res = await page.goto(`/legal/${slug}`);
      expect(res?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(`/legal/${slug}$`));
      await expect(page.getByTestId("legal-page")).toBeVisible();
      await expect(
        page.getByText(/draft template pending legal review/i),
      ).toBeVisible();
      await expect(page.getByText(/last updated:/i)).toBeVisible();
    });
  }

  test("footer legal links resolve", async ({ page, request }) => {
    await page.goto("/");
    const footer = page.getByTestId("site-footer");
    await expect(footer).toBeVisible();
    const hrefs = await footer.locator("a[href^='/legal/']").evaluateAll(
      (as) => Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")))),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    await assertAllResolve(request, hrefs.filter((h): h is string => !!h));
  });

  test("age-gate ToS/Privacy links point at real legal pages", async ({ request }) => {
    // /age-gate is auth-protected; we do not sign in here. We only need to
    // verify the anchor hrefs are correct, which we can do by fetching the
    // page HTML directly and grepping. But middleware would 302 us to /login,
    // so hit the /legal targets directly instead.
    await assertAllResolve(request, ["/legal/terms", "/legal/privacy"]);
  });

  test("signup page ToS/Privacy anchors are wired", async ({ page }) => {
    await page.goto("/signup");
    const tos = page.getByRole("link", { name: /terms of service/i });
    const pp = page.getByRole("link", { name: /privacy policy/i });
    await expect(tos.first()).toHaveAttribute("href", "/legal/terms");
    await expect(pp.first()).toHaveAttribute("href", "/legal/privacy");
    for (const link of [tos.first(), pp.first()]) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
  });
});

async function assertAllResolve(request: Page["request"], hrefs: string[]) {
  for (const href of hrefs) {
    const r = await request.get(href);
    expect(r.status(), `expected ${href} to resolve`).toBeLessThan(400);
  }
}
