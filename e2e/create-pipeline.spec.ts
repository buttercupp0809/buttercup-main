// Phase 28 create-pipeline E2E. Per CLAUDE.md, Playwright specs live at the
// repo-root e2e/ directory (baseURL http://localhost:3000), NOT
// frontend/e2e/ as an older draft of the phase plan named it; this file is
// placed here to match every other spec in this suite (see e2e/gallery.spec.ts,
// e2e/persona-selection.spec.ts).
//
// Gated behind E2E_SEEDED=1 + E2E_VERIFIED_COOKIE (same convention as
// persona-selection.spec.ts) since it needs an age-verified, authenticated
// session. The image backend is STUBBED by intercepting the
// generation-status poll response rather than requiring a real ComfyUI/
// Fal/Replicate call or a running BullMQ worker; this still exercises the
// real wizard submit -> POST /api/characters -> generate-images enqueue path,
// only the polling UI's "is it ready yet" signal is faked so the test does
// not depend on GPU infrastructure.
//
// NOT EXECUTED in this session: no local dev server, seeded DB, or
// E2E_VERIFIED_COOKIE were trivially available. Selectors are written against
// the wizard's current DOM structure (frontend/app/(protected)/create/*,
// components/create/GenerationStatus.tsx) but have not been run against a
// live page, so minor locator adjustments may be needed on first real run.

import { test, expect } from "@playwright/test";

const seeded = process.env.E2E_SEEDED === "1";
const verifiedCookie = process.env.E2E_VERIFIED_COOKIE;

test.describe("create pipeline (Phase 28)", () => {
  test("wizard finish enqueues generation and the status screen reaches ready", async ({ page }) => {
    test.skip(
      !seeded || !verifiedCookie,
      "needs seeded DB + an age-verified user session cookie (E2E_VERIFIED_COOKIE)",
    );

    await page.context().addCookies([
      { name: "buttercupp_auth", value: verifiedCookie!, url: "http://localhost:3000" },
    ]);

    let createdCharacterId: string | null = null;

    // Stub the generation-status poll: first response mid-flight, then all
    // ready, so the UI's pending -> generating -> ready transition can be
    // asserted without a real worker draining the queue.
    let statusCallCount = 0;
    await page.route("**/api/characters/*/generation-status", async (route) => {
      statusCallCount += 1;
      const body =
        statusCallCount === 1
          ? { queued: 3, processing: 1, ready: 0, failed: 0, primaryReady: false }
          : { queued: 0, processing: 0, ready: 4, failed: 0, primaryReady: true };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route("**/api/characters/*/gallery?limit=1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "stub-media-1", url: "https://cdn.example.com/stub.png", s3Key: "stub", createdAt: new Date().toISOString() }],
          nextCursor: null,
        }),
      });
    });

    await page.goto("/create/style");

    // Step 1: style.
    await page.getByRole("button", { name: /realistic/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2: identity. Age and gender are preset pill/card buttons, not
    // free-text inputs, and the Name field has no <label> association (it is
    // a decorative heading span next to a placeholder-only input), so it is
    // targeted by placeholder rather than getByLabel.
    await expect(page).toHaveURL(/\/create\/identity/);
    await page.getByRole("button", { name: /female/i }).click();
    await page.getByRole("button", { name: "25", exact: true }).click();
    await page.getByPlaceholder(/pick a suggestion or type your own/i).fill("E2E Test Persona");
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3: appearance. stylePrompt is required, set by picking a
    // look and lighting vibe card (there is no free-text prompt field).
    await expect(page).toHaveURL(/\/create\/appearance/);
    await page.getByRole("button", { name: /cinematic/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 4: personality. backstory/traitTags/behavioralInstructions/
    // greeting/bio are all filled by picking an archetype card; voiceProfile
    // still needs its own selection.
    await expect(page).toHaveURL(/\/create\/personality/);
    await page.getByRole("button", { name: /girl next door/i }).click();
    await page.getByRole("button", { name: /warm alto/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 5: publish + finish.
    await expect(page).toHaveURL(/\/create\/publish/);
    await page.getByRole("button", { name: /private/i }).click();
    await page.getByRole("button", { name: /standard/i }).click();

    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/characters") && r.request().method() === "POST"),
      page.getByRole("button", { name: /^finish$/i }).click(),
    ]);
    const createBody = (await createResponse.json()) as { id: string };
    createdCharacterId = createBody.id;
    expect(createdCharacterId).toBeTruthy();

    // Finish screen: initial pending/generating skeletons.
    await expect(page.getByText(/bringing your companion to life/i)).toBeVisible();

    // After the second (stubbed) poll tick, primaryReady flips true and the
    // preview image renders.
    await expect(page.locator("img[alt='']")).toBeVisible({ timeout: 10_000 });

    // "Start chatting" is always enabled, even while polling is mid-flight.
    const startChatting = page.getByRole("link", { name: /start chatting/i });
    await expect(startChatting).toBeEnabled();
    await startChatting.click();
    await expect(page).toHaveURL(/\/chat\//);
  });

  test("editing a character's appearance bumps versionNo and re-enqueues generation", async ({ page }) => {
    test.skip(
      !seeded || !verifiedCookie,
      "needs seeded DB + an age-verified user session cookie (E2E_VERIFIED_COOKIE) owning an existing character",
    );
    const ownedCharacterId = process.env.E2E_OWNED_CHARACTER_ID;
    test.skip(!ownedCharacterId, "needs E2E_OWNED_CHARACTER_ID (a character owned by the session user)");

    await page.context().addCookies([
      { name: "buttercupp_auth", value: verifiedCookie!, url: "http://localhost:3000" },
    ]);

    let generateImagesCalled = false;
    await page.route("**/api/characters/*/generate-images", async (route) => {
      generateImagesCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "queued", assetIds: ["stub-1", "stub-2"] }),
      });
    });

    const beforeDetail = await page.request.get(`/api/characters/${ownedCharacterId}`);
    const beforeBody = (await beforeDetail.json()) as {
      version: { versionNo: number };
      editDraft?: { stylePrompt?: string };
    };
    const beforeVersionNo = beforeBody.version.versionNo;
    // Pick a vibe guaranteed to differ from whatever is currently set (the
    // test may run repeatedly against the same character across retries or
    // manual re-runs, and appearanceChanged() is a no-op if the "new" value
    // is identical to the original).
    const currentStylePrompt = beforeBody.editDraft?.stylePrompt ?? "";
    const targetVibe = currentStylePrompt.includes("neon") ? /cinematic/i : /neon night/i;

    await page.goto(`/characters/${ownedCharacterId}`);
    await page.getByRole("link", { name: /edit companion/i }).click();
    // The edit link always lands on the style step first, regardless of
    // which step the character was last edited on.
    await expect(page).toHaveURL(/\/create\/style\?.*editCharacterId=/);

    // Change an appearance-affecting field on the appearance step by picking
    // a different look-and-lighting vibe than whatever the seed used (there
    // is no free-text prompt field, stylePrompt only changes via these
    // preset cards; appearanceChanged() diffs stylePrompt against the
    // original draft).
    await page.getByRole("button", { name: /^next$/i }).click(); // style -> identity
    await expect(page).toHaveURL(/\/create\/identity/);
    await page.getByRole("button", { name: /^next$/i }).click(); // identity -> appearance
    await expect(page).toHaveURL(/\/create\/appearance/);
    await page.getByRole("button", { name: targetVibe }).click();
    await page.getByRole("button", { name: /^next$/i }).click(); // appearance -> personality
    await expect(page).toHaveURL(/\/create\/personality/);
    await page.getByRole("button", { name: /^next$/i }).click(); // personality -> publish
    await expect(page).toHaveURL(/\/create\/publish/);

    // Read the versionNo via a fresh authenticated GET after the save
    // completes rather than parsing the intercepted PATCH response body
    // directly: GenerationStatus starts polling generation-status every ~2s
    // the instant submit() resolves, and racing that flood against reading
    // the PATCH response's body through Playwright's CDP connection can hang
    // (the browser evicts the buffered body once enough requests pile up
    // behind it on the same connection). Waiting for the response's status
    // still proves the PATCH round-tripped; the version bump is then
    // confirmed independently.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/characters/${ownedCharacterId}`) &&
          r.request().method() === "PATCH" &&
          r.status() === 200,
      ),
      page.getByRole("button", { name: /save changes/i }).click(),
    ]);

    await expect
      .poll(async () => {
        const detail = await page.request.get(`/api/characters/${ownedCharacterId}`);
        const body = (await detail.json()) as { version: { versionNo: number } };
        return body.version.versionNo;
      })
      .toBeGreaterThan(beforeVersionNo);

    // The re-enqueue fetch is fired fire-and-forget from submit() after the
    // PATCH resolves, so it can still be in flight even once the version
    // bump above is already visible via a separate GET; give it a moment.
    await expect.poll(() => generateImagesCalled).toBe(true);
  });
});
