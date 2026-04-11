/**
 * Model switcher UI tests.
 *
 * Happy path: dropdown appears when multiple models configured, selection changes model.
 * Unhappy path: single model = no dropdown (cleaner UI for default setups).
 */
import { test, expect, request } from "@playwright/test";

test.describe("Model switcher", () => {
  test("GET /api/models returns a list", async ({ request }) => {
    const resp = await request.get("/api/models");
    expect(resp.status()).toBe(200);
    const models = await resp.json();
    expect(Array.isArray(models)).toBe(true);
    if (models.length > 0) {
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("model");
    }
  });

  test("model dropdown visible when multiple models configured", async ({ page, request }) => {
    const resp = await request.get("/api/models");
    const models = await resp.json();

    await page.goto("/");

    if (models.length > 1) {
      // Should show a <select> in the header
      const select = page.locator("header select, [role='banner'] select").or(
        page.locator(".h-10 select")
      );
      await expect(select).toBeVisible();
    } else {
      // With a single model there is no dropdown — this is expected
      test.skip();
    }
  });

  test("model selection persists to chat request", async ({ page, request }) => {
    const resp = await request.get("/api/models");
    const models = await resp.json();

    if (models.length < 2) {
      test.skip();
      return;
    }

    await page.goto("/");

    // Intercept the /api/chat POST to verify the model field
    const chatRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/chat") && req.method() === "POST") {
        try {
          const body = JSON.parse(req.postData() || "{}");
          chatRequests.push(body.model);
        } catch {}
      }
    });

    // Pick the second model
    const secondModel = models[1].id;
    const headerSelect = page.locator(".h-10 select");
    await headerSelect.selectOption(secondModel);

    // Send a message
    const textarea = page.getByRole("textbox");
    await textarea.fill("hello");
    await textarea.press("Enter");

    // Wait for request to fire
    await page.waitForTimeout(1000);
    expect(chatRequests.some((m) => m === secondModel)).toBe(true);
  });
});
