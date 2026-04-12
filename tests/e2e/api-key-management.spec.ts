/**
 * E2E tests for API key management UI and endpoints.
 *
 * Happy path: generate key → shows key → revoke → auth disabled.
 * Unhappy path: generate when key already exists, revoke when none.
 *
 * Covers ISSUES.md #10.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

async function deleteKeyWithAuth(request: import("@playwright/test").APIRequestContext) {
  const resp = await request.delete("/api/auth/key");
  if (resp.status() === 401) {
    try {
      const key = readFileSync(resolve(__dirname, "../../../workspace/api_key"), "utf-8").trim();
      await request.delete("/api/auth/key", { headers: { "X-API-Key": key } });
    } catch {
      // ignore
    }
  }
}

// Run serially: key creation/deletion affects global auth state
test.describe.serial("API key management API", () => {
  test.afterEach(async ({ request }) => {
    // Always clean up so subsequent tests start without auth
    await deleteKeyWithAuth(request);
  });
  test("GET /api/auth/status returns auth_enabled bool", async ({ request }) => {
    const resp = await request.get("/api/auth/status");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(typeof data.auth_enabled).toBe("boolean");
  });

  test("DELETE /api/auth/key returns 200 or 404", async ({ request }) => {
    // Whether or not a key exists, the endpoint must respond cleanly
    const resp = await request.delete("/api/auth/key");
    expect([200, 404]).toContain(resp.status());
  });

  test("POST /api/auth/key generates a key when none exists", async ({ request }) => {
    // Ensure clean state
    await request.delete("/api/auth/key");

    const resp = await request.post("/api/auth/key");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.api_key).toBeTruthy();
    expect(typeof data.api_key).toBe("string");
    expect(data.api_key.length).toBeGreaterThan(20);

    // Cleanup
    await request.delete("/api/auth/key");
  });

  test("POST /api/auth/key regenerates when force=true", async ({ request }) => {
    // Clean start
    await request.delete("/api/auth/key");
    const first = await (await request.post("/api/auth/key")).json();
    const second = await (await request.post("/api/auth/key?force=true")).json();
    expect(second.api_key).toBeTruthy();
    expect(second.api_key).not.toBe(first.api_key);

    // Cleanup
    await request.delete("/api/auth/key");
  });

  test("POST /api/auth/key without force returns 409 if key exists", async ({ request }) => {
    await request.delete("/api/auth/key");
    await request.post("/api/auth/key");

    const resp = await request.post("/api/auth/key");
    // Returns 409 Conflict when a key already exists and force is not set
    expect(resp.status()).toBe(409);
  });
});

// API Key panel removed from UI — auth managed via API only
test.describe.skip("API key management UI", () => {
  test("API Key panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button[title='API Key']").click();
    await expect(page.locator("text=API Key")).toBeVisible({ timeout: 3000 });
  });

  test("API Key panel shows current auth status", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button[title='API Key']").click();
    // Shows either enabled or disabled state
    await expect(
      page.locator("text=/Auth enabled|Auth disabled|No API key/i")
    ).toBeVisible({ timeout: 3000 });
  });
});
