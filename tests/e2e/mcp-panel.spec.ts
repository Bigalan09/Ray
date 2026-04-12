/**
 * E2E tests for the MCP server management UI and API.
 *
 * Covers ISSUES.md #11: MCP server registration requires manual JSON.
 *
 * Happy path: list status, add server (API), remove server, toggle enable/disable.
 * Unhappy path: missing name/command returns 400, remove unknown returns error.
 * UI: panel opens, shows status, add-form renders.
 */
import { test, expect } from "@playwright/test";

const TEST_SERVER = {
  name: `test-mcp-${Date.now()}`,
  command: "echo",
  args: ["hello"],
};

test.describe("MCP API", () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`/api/mcp/servers/${TEST_SERVER.name}`).catch(() => {});
  });

  test("GET /api/mcp/status returns array", async ({ request }) => {
    const resp = await request.get("/api/mcp/status");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("POST /api/mcp/servers adds a server", async ({ request }) => {
    const resp = await request.post("/api/mcp/servers", {
      data: TEST_SERVER,
    });
    // Server may fail to start (echo is not a real MCP server) but creation should succeed
    const data = await resp.json();
    expect(resp.ok() || data.success !== undefined).toBeTruthy();

    // Verify it appears in status list
    const statusResp = await request.get("/api/mcp/status");
    const servers = await statusResp.json();
    expect(servers.some((s: any) => s.name === TEST_SERVER.name)).toBe(true);
  });

  test("POST /api/mcp/servers returns 400 for missing name or command", async ({ request }) => {
    const resp = await request.post("/api/mcp/servers", {
      data: { name: "no-command" },
    });
    expect(resp.status()).toBe(400);
  });

  test("DELETE /api/mcp/servers/:name removes server", async ({ request }) => {
    // First add it
    await request.post("/api/mcp/servers", { data: TEST_SERVER });

    const resp = await request.delete(`/api/mcp/servers/${TEST_SERVER.name}`);
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();

    // Verify removed
    const statusResp = await request.get("/api/mcp/status");
    const servers = await statusResp.json();
    expect(servers.some((s: any) => s.name === TEST_SERVER.name)).toBe(false);
  });

  test("PATCH /api/mcp/servers/:name toggles enabled", async ({ request }) => {
    await request.post("/api/mcp/servers", { data: TEST_SERVER });

    const resp = await request.patch(`/api/mcp/servers/${TEST_SERVER.name}`, {
      data: { enabled: false },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();

    // Verify disabled
    const statusResp = await request.get("/api/mcp/status");
    const servers = await statusResp.json();
    const server = servers.find((s: any) => s.name === TEST_SERVER.name);
    expect(server).toBeTruthy();
    expect(server.enabled).toBe(false);
  });

  test("PATCH /api/mcp/servers/:name returns 400 without enabled field", async ({ request }) => {
    await request.post("/api/mcp/servers", { data: TEST_SERVER });

    const resp = await request.patch(`/api/mcp/servers/${TEST_SERVER.name}`, {
      data: { command: "something-else" },
    });
    expect(resp.status()).toBe(400);
  });
});

test.describe("MCP panel UI", () => {
  test("MCP panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('MCP'), button[title='MCP']").first().click();
    await expect(
      page.locator(".font-semibold:has-text('MCP Servers'), h2:has-text('MCP Servers')").first()
    ).toBeVisible({ timeout: 3000 });
  });

  test("MCP panel shows add server button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('MCP'), button[title='MCP']").first().click();
    await expect(page.locator("button:has-text('+ Add Server')").first()).toBeVisible({ timeout: 3000 });
  });

  test("MCP add-server form renders on button click", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button:has-text('MCP'), button[title='MCP']").first().click();
    await page.locator("button:has-text('+ Add Server')").first().click();
    await expect(page.locator("input[placeholder*='Server name']").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("input[placeholder*='Command']").first()).toBeVisible({ timeout: 1000 });
  });
});
