import { test, expect } from "@playwright/test";

test.describe("Exec command API", () => {
  test("/exec list returns allowed commands", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/exec list");
    await page.click("button:has-text('Send')");
    await expect(
      page.locator(".message-content:has-text('Allowed exec commands')")
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(".message-content:has-text('git status')")
    ).toBeVisible({ timeout: 5000 });
  });

  test("/exec with disallowed command shows error", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/exec curl http://example.com");
    await page.click("button:has-text('Send')");
    await expect(
      page.locator(".message-content:has-text('Command not permitted')")
    ).toBeVisible({ timeout: 5000 });
  });

  test("/exec with shell metacharacters is rejected", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/exec git status; rm -rf /");
    await page.click("button:has-text('Send')");
    await expect(
      page.locator(".message-content:has-text('metacharacters')")
    ).toBeVisible({ timeout: 5000 });
  });

  test("/exec with allowed command shows approval bar in input area", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/exec whoami");
    await page.click("button:has-text('Send')");

    // The approval bar should replace the input area
    await expect(page.locator("text=Allow Ray to run command?")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("code:has-text('whoami')")).toBeVisible();
    await expect(page.locator("button:has-text('Allow')")).toBeVisible();
    await expect(page.locator("button:has-text('Deny')")).toBeVisible();
    // Normal textarea should be hidden
    await expect(page.locator("textarea")).not.toBeVisible();
  });

  test("/exec allow executes the command", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    await page.locator("textarea").fill("/exec whoami");
    await page.click("button:has-text('Send')");

    // Wait for approval bar and click Allow
    await expect(page.locator("button:has-text('Allow')")).toBeVisible({ timeout: 5000 });
    await page.click("button:has-text('Allow')");

    // Normal textarea should return
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });
  });

  test("/exec disallowed subcommand rejected via API", async ({ request }) => {
    // Test via the tool API to avoid UI state interference
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "exec_command", arguments: { command: "git push" } },
    });
    const data = await resp.json();
    expect(data.error).toBeTruthy();
    expect(data.error).toContain("not allowed");
  });
});

test.describe("Exec API endpoints", () => {
  test("GET /api/commands includes /exec", async ({ request }) => {
    const resp = await request.get("/api/commands");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    const names = data.map((c: any) => c.name);
    expect(names).toContain("/exec");
  });

  test("GET /api/tools includes exec_command", async ({ request }) => {
    const resp = await request.get("/api/tools");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    const names = data.map((t: any) => t.name);
    expect(names).toContain("exec_command");
  });

  test("POST /api/exec/approve with invalid ID returns expired", async ({ request }) => {
    const resp = await request.post("/api/exec/approve", {
      data: { pending_id: "nonexistent123" },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.expired).toBeTruthy();
    expect(data.error).toBeTruthy();
  });

  test("POST /api/exec/deny with invalid ID returns expired", async ({ request }) => {
    const resp = await request.post("/api/exec/deny", {
      data: { pending_id: "nonexistent123" },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.expired).toBeTruthy();
  });

  test("exec_command tool validates and returns approval_required", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "exec_command", arguments: { command: "whoami" } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.status).toBe("approval_required");
    expect(data.pending_id).toBeTruthy();
    expect(data.command).toBe("whoami");
  });

  test("exec_command tool rejects disallowed commands", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "exec_command", arguments: { command: "rm -rf /" } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.error).toBeTruthy();
    expect(data.error).toContain("not in the allowed commands list");
  });

  test("full approve flow: tool creates pending, approve executes", async ({ request }) => {
    // Step 1: Create a pending execution via the tool
    const toolResp = await request.post("/api/tools/execute", {
      data: { tool_name: "exec_command", arguments: { command: "whoami" } },
    });
    const toolData = await toolResp.json();
    expect(toolData.status).toBe("approval_required");
    const pendingId = toolData.pending_id;

    // Step 2: Approve it
    const approveResp = await request.post("/api/exec/approve", {
      data: { pending_id: pendingId },
    });
    expect(approveResp.ok()).toBeTruthy();
    const approveData = await approveResp.json();
    expect(approveData.data).toBeTruthy();
    expect(approveData.data.exit_code).toBe(0);
    expect(approveData.data.stdout).toBeTruthy();
  });
});

test.describe("Clear all sessions", () => {
  test("DELETE /api/conversations deletes all and returns count", async ({ request }) => {
    // Create a few conversations
    await request.post("/api/conversations", { data: { title: "Clear Test 1" } });
    await request.post("/api/conversations", { data: { title: "Clear Test 2" } });

    const resp = await request.delete("/api/conversations");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.success).toBeTruthy();
    expect(data.deleted).toBeGreaterThanOrEqual(2);

    // Verify all gone
    const listResp = await request.get("/api/conversations");
    const list = await listResp.json();
    expect(list.length).toBe(0);
  });

  test("/clear all command deletes all sessions", async ({ page }) => {
    // Create a conversation first
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("textarea").fill("test message for clear all");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content").first()).toBeVisible({ timeout: 5000 });

    // Now clear all
    await page.locator("textarea").fill("/clear all");
    await page.click("button:has-text('Send')");

    // Messages should be cleared
    await expect(page.locator(".message-content")).toHaveCount(0, { timeout: 5000 });
  });

  test("clear all button shows confirmation and clears sidebar", async ({ page }) => {
    // Create a conversation via the UI
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("textarea").fill("session to clear");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content").first()).toBeVisible({ timeout: 10000 });

    // Accept the confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Click clear all
    await page.click("text=Clear all sessions");

    // Sidebar should show no sessions
    await expect(page.locator("text=No sessions yet")).toBeVisible({ timeout: 5000 });
  });
});
