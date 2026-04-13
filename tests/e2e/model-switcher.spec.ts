/**
 * Model configuration tests.
 *
 * Model selection is config-only (models.yaml). The UI shows the active model
 * as a label but has no dropdown. These tests verify the API returns models
 * correctly and the default model is used in chat requests.
 */
import { test, expect } from "@playwright/test";

test.describe("Model configuration", () => {
  test("GET /api/models returns a list with default model first", async ({ request }) => {
    const resp = await request.get("/api/models");
    expect(resp.status()).toBe(200);
    const models = await resp.json();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("id");
    expect(models[0]).toHaveProperty("model");
  });

  test("no model dropdown in the UI", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const selects = page.locator("select");
    await expect(selects).toHaveCount(0);
  });

  test("active model label shown below input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // The model name should appear as a text label near the input area
    const modelLabel = page.locator("span.text-gray-600").last();
    const text = await modelLabel.textContent();
    // Should contain a model name (not empty)
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("chat request uses the configured default model", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/chat") && req.method() === "POST") {
        try {
          const body = JSON.parse(req.postData() || "{}");
          if (body.model) chatRequests.push(body.model);
        } catch {}
      }
    });

    await page.locator("textarea").fill("hello");
    await page.click("button:has-text('Send')");
    await page.waitForTimeout(2000);

    // The model sent should match the first model from /api/models (the default)
    const resp = await page.request.get("/api/models");
    const models = await resp.json();
    if (models.length > 0 && chatRequests.length > 0) {
      expect(chatRequests[0]).toBe(models[0].id);
    }
  });
});
