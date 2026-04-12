/**
 * E2E tests for the Settings panel UI and API.
 *
 * Covers ISSUES.md #12: Settings panel missing entirely.
 *
 * Happy path: load settings, patch logging level, reset overrides.
 * Unhappy path: reject non-writable keys, reject unknown structure.
 * UI: panel opens, shows logging section, save/reset buttons.
 */
import { test, expect } from "@playwright/test";

test.describe("Settings API", () => {
  test("GET /api/settings returns settings structure", async ({ request }) => {
    const resp = await request.get("/api/settings");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty("logging");
    expect(data).toHaveProperty("models");
    expect(data).toHaveProperty("guardrails");
    expect(data).toHaveProperty("rate_limit");
    expect(Array.isArray(data.writable_keys)).toBeTruthy();
    expect(data.writable_keys.length).toBeGreaterThan(0);
  });

  test("PATCH /api/settings updates logging level", async ({ request }) => {
    const resp = await request.patch("/api/settings", {
      data: { updates: { logging: { level: "DEBUG" } } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();

    // Verify the override is reflected
    const getResp = await request.get("/api/settings");
    const settings = await getResp.json();
    expect(settings.logging.level).toBe("DEBUG");

    // Cleanup
    await request.delete("/api/settings/overrides");
  });

  test("PATCH /api/settings rejects non-writable keys", async ({ request }) => {
    const resp = await request.patch("/api/settings", {
      data: { updates: { models: { default_model: "gpt-4" } } },
    });
    expect(resp.status()).toBe(400);
  });

  test("DELETE /api/settings/overrides resets to defaults", async ({ request }) => {
    // First set an override
    await request.patch("/api/settings", {
      data: { updates: { logging: { level: "DEBUG" } } },
    });

    const resp = await request.delete("/api/settings/overrides");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();

    // Workspace overrides should be empty
    const getResp = await request.get("/api/settings");
    const settings = await getResp.json();
    expect(Object.keys(settings.workspace_overrides ?? {}).length).toBe(0);
  });
});

test.describe("Settings panel UI", () => {
  test("Settings panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('Settings'), button[title='Settings']").first().click();
    await expect(
      page.locator(".font-semibold:has-text('Settings'), h2:has-text('Settings')").first()
    ).toBeVisible({ timeout: 3000 });
  });

  test("Settings panel shows logging section", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('Settings'), button[title='Settings']").first().click();
    await expect(page.locator("text=Logging").first()).toBeVisible({ timeout: 3000 });
  });

  test("Settings panel shows save and reset buttons", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('Settings'), button[title='Settings']").first().click();
    await expect(page.locator("button:has-text('Save changes')").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("button:has-text('Reset to defaults')").first()).toBeVisible({ timeout: 1000 });
  });
});
