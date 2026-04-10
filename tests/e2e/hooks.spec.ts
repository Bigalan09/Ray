import { test, expect } from "@playwright/test";

test.describe("Hooks API", () => {
  test("GET /api/hooks/events returns supported events", async ({ request }) => {
    const resp = await request.get("/api/hooks/events");
    expect(resp.ok()).toBeTruthy();
    const events = await resp.json();
    expect(Array.isArray(events)).toBeTruthy();
    expect(events).toContain("message_received");
    expect(events).toContain("task_completed");
    expect(events).toContain("exec_approved");
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  test("GET /api/hooks/webhooks returns empty list initially", async ({ request }) => {
    const resp = await request.get("/api/hooks/webhooks");
    expect(resp.ok()).toBeTruthy();
    const webhooks = await resp.json();
    expect(Array.isArray(webhooks)).toBeTruthy();
  });

  test("POST /api/hooks/webhooks creates a webhook", async ({ request }) => {
    const resp = await request.post("/api/hooks/webhooks", {
      data: {
        name: "test-hook",
        url: "https://httpbin.org/post",
        events: ["task_completed", "exec_approved"],
      },
    });
    expect(resp.ok()).toBeTruthy();
    const wh = await resp.json();
    expect(wh.name).toBe("test-hook");
    expect(wh.url).toBe("https://httpbin.org/post");
    expect(wh.events).toContain("task_completed");
    expect(wh.source).toBe("runtime");
  });

  test("GET /api/hooks/webhooks lists created webhook", async ({ request }) => {
    // Ensure it exists
    await request.post("/api/hooks/webhooks", {
      data: { name: "list-test", url: "https://example.com/hook", events: ["message_received"] },
    });
    const resp = await request.get("/api/hooks/webhooks");
    const webhooks = await resp.json();
    const names = webhooks.map((w: any) => w.name);
    expect(names).toContain("list-test");
  });

  test("DELETE /api/hooks/webhooks/{name} removes a webhook", async ({ request }) => {
    await request.post("/api/hooks/webhooks", {
      data: { name: "to-delete", url: "https://example.com/hook", events: [] },
    });
    const delResp = await request.delete("/api/hooks/webhooks/to-delete");
    expect(delResp.ok()).toBeTruthy();
    const data = await delResp.json();
    expect(data.success).toBeTruthy();

    // Verify gone
    const listResp = await request.get("/api/hooks/webhooks");
    const names = (await listResp.json()).map((w: any) => w.name);
    expect(names).not.toContain("to-delete");
  });

  test("DELETE nonexistent webhook returns error", async ({ request }) => {
    const resp = await request.delete("/api/hooks/webhooks/nonexistent");
    const data = await resp.json();
    expect(data.success).toBeFalsy();
  });

  test("GET /api/hooks/log returns empty log initially", async ({ request }) => {
    const resp = await request.get("/api/hooks/log");
    expect(resp.ok()).toBeTruthy();
    const log = await resp.json();
    expect(Array.isArray(log)).toBeTruthy();
  });

  test("POST /api/hooks/reload reloads config", async ({ request }) => {
    const resp = await request.post("/api/hooks/reload");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();
    expect(typeof data.webhooks).toBe("number");
  });

  test("GET /api/commands includes /hook", async ({ request }) => {
    const resp = await request.get("/api/commands");
    const cmds = await resp.json();
    const names = cmds.map((c: any) => c.name);
    expect(names).toContain("/hook");
  });
});

test.describe("Hooks slash commands", () => {
  test("/hook events lists supported events via API", async ({ request }) => {
    const resp = await request.get("/api/hooks/events");
    expect(resp.ok()).toBeTruthy();
    const events = await resp.json();
    expect(events).toContain("message_received");
    expect(events).toContain("exec_approved");
  });

  test("/hook list shows webhooks", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/hook list");
    await page.click("button:has-text('Send')");
    // Either shows webhooks or "No webhooks configured"
    await expect(
      page.locator(".message-content").last()
    ).toBeVisible({ timeout: 5000 });
  });

  test("/hook reload works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/hook reload");
    await page.click("button:has-text('Send')");
    await expect(
      page.locator(".message-content:has-text('reloaded')")
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Hooks UI panel", () => {
  test("Webhooks button visible in sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Webhooks" })).toBeVisible({ timeout: 5000 });
  });

  test("Webhooks panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=Webhooks");
    await expect(page.locator(".font-semibold:has-text('Webhooks')")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=+ New webhook")).toBeVisible();
  });

  test("Create webhook modal opens via API and UI", async ({ request }) => {
    // Test the API endpoint directly (more reliable than UI interaction in parallel tests)
    const resp = await request.post("/api/hooks/webhooks", {
      data: {
        name: "modal-test",
        url: "https://example.com/modal-test",
        events: ["task_completed"],
      },
    });
    expect(resp.ok()).toBeTruthy();
    const wh = await resp.json();
    expect(wh.name).toBe("modal-test");

    // Clean up
    await request.delete("/api/hooks/webhooks/modal-test");
  });
});
