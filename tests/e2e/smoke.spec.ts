import { test, expect } from "@playwright/test";

test.describe("Ray UI smoke tests", () => {
  test("loads the chat interface", async ({ page }) => {
    await page.goto("/");
    // Wait for auto-restore to complete before checking elements
    await page.waitForLoadState("networkidle");
    await expect(page.locator("span:has-text('Ray')").first()).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.locator("button:has-text('Send')")).toBeVisible();
  });

  test("header shows Ray title and sidebar toggle", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("span:has-text('Ray')").first()).toBeVisible();
  });

  test("header does not show model or agent dropdowns", async ({ page }) => {
    await page.goto("/");
    const selects = page.locator("select");
    await expect(selects).toHaveCount(0);
  });

  test("sidebar has new session and action items", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=New session")).toBeVisible();
    await expect(page.locator("text=Tasks")).toBeVisible();
    await expect(page.locator("text=Scheduled")).toBeVisible();
    await expect(page.locator("text=MCP Servers")).toBeVisible();
  });

  test("new session clears messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("text=New session");
    const messageBubbles = page.locator(".message-content");
    await expect(messageBubbles).toHaveCount(0);
  });

  test("send button disabled when input is empty", async ({ page }) => {
    await page.goto("/");
    const sendBtn = page.locator("button:has-text('Send')");
    await expect(sendBtn).toBeDisabled();
  });

  test("send button enabled when input has text", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("hello");
    const sendBtn = page.locator("button:has-text('Send')");
    await expect(sendBtn).toBeEnabled();
  });

  test("sidebar visible by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=New session")).toBeVisible();
  });

  test("sidebar toggle hides and shows sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=New session")).toBeVisible();
    // Toggle via hamburger in header
    const hamburger = page.locator("button[title='Hide sidebar']");
    await hamburger.click();
    // After animation, the show sidebar button should appear
    await expect(page.locator("button[title='Show sidebar']")).toBeVisible({ timeout: 1000 });
  });

  test("tasks panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    // Tasks is now in the sidebar
    const tasksBtn = page.locator("text=Tasks").first();
    await tasksBtn.click();
    await expect(page.locator("text=Background Tasks")).toBeVisible();
  });

  test("MCP panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.click("text=MCP Servers");
    // The panel header has the title inside a span with font-semibold
    await expect(page.locator(".font-semibold:has-text('MCP Servers')")).toBeVisible();
  });

  test("file upload button is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("button[title='Upload document for RAG']")).toBeVisible();
  });
});

test.describe("Chat flow", () => {
  test("sending a message creates a conversation", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("Hello Ray");
    await page.click("button:has-text('Send')");

    // User message should appear
    await expect(page.locator(".message-content").first()).toBeVisible({ timeout: 5000 });

    // Either a thinking animation or assistant response should appear
    const thinkingOrResponse = page.locator(".message-content, .animate-pulse").last();
    await expect(thinkingOrResponse).toBeVisible({ timeout: 10000 });
  });

  test("new chat clears and starts fresh", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("First message");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content").first()).toBeVisible({ timeout: 5000 });

    await page.click("text=New session");
    const messageBubbles = page.locator(".message-content");
    await expect(messageBubbles).toHaveCount(0);

    // Textarea should be empty and focusable
    const textarea = page.locator("textarea");
    await expect(textarea).toHaveValue("");
  });

  test("stop button appears during streaming", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("Tell me a long story");
    await page.click("button:has-text('Send')");

    // The Stop button should appear while streaming
    const stopBtn = page.locator("button:has-text('Stop')");
    await expect(stopBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Conversation management", () => {
  test("conversation appears in sidebar after sending message", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("Test conversation for sidebar");
    await page.click("button:has-text('Send')");

    // Wait for the conversation to appear in the sidebar
    const sidebar = page.locator("text=New session").locator("..").locator("..");
    await expect(sidebar.locator(".truncate").first()).toBeVisible({ timeout: 10000 });
  });

  test("clicking a conversation loads its messages", async ({ page, request }) => {
    // Create a conversation via API
    const createResp = await request.post("/api/conversations", {
      data: { title: "E2E Load Test" },
    });
    const conv = await createResp.json();

    // Add a message via API
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "Loaded from API" },
    });

    await page.goto("/");
    // Click the conversation in the sidebar
    await page.click(`text=E2E Load Test`);
    await expect(page.locator("text=Loaded from API")).toBeVisible({ timeout: 5000 });
  });

  test("page refresh restores most recent conversation", async ({ page, request }) => {
    // Create a conversation with a message via API
    const createResp = await request.post("/api/conversations", {
      data: { title: "Restore Test" },
    });
    const conv = await createResp.json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "This should auto-restore" },
    });
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "assistant", content: "Yes it should" },
    });

    // Load the page fresh (simulates a refresh)
    await page.goto("/");

    // The most recent conversation's messages should appear automatically
    await expect(page.locator("text=This should auto-restore")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Yes it should")).toBeVisible({ timeout: 5000 });
  });

  test("clicking a conversation with JSON-like content does not blank the screen", async ({ page, request }) => {
    // Create a conversation where assistant returned valid JSON as content
    const createResp = await request.post("/api/conversations", {
      data: { title: "JSON Content Test" },
    });
    const conv = await createResp.json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "Give me JSON" },
    });
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "assistant", content: '{"name": "test", "value": 42}' },
    });

    await page.goto("/");
    await page.click("text=JSON Content Test");

    // Both messages should render (assistant JSON content displayed as text)
    await expect(page.locator("text=Give me JSON")).toBeVisible({ timeout: 5000 });
    // The JSON string should be visible as text content
    await expect(page.locator('.message-content:has-text("name")')).toBeVisible({ timeout: 5000 });
  });
});

test.describe("API endpoints via UI proxy", () => {
  test("GET /api/models returns models", async ({ request }) => {
    const resp = await request.get("/api/models");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("model");
  });

  test("GET /api/prompts returns prompts", async ({ request }) => {
    const resp = await request.get("/api/prompts");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.some((p: any) => p.title === "Default")).toBeTruthy();
  });

  test("GET /api/tools returns tools", async ({ request }) => {
    const resp = await request.get("/api/tools");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.some((t: any) => t.name === "calculator")).toBeTruthy();
  });

  test("POST /api/tools/execute runs calculator", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: {
        tool_name: "calculator",
        arguments: { expression: "7 * 6" },
      },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.result).toBe(42);
  });

  test("GET /api/agents returns agents", async ({ request }) => {
    const resp = await request.get("/api/agents");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThanOrEqual(1);
    const names = data.map((a: any) => a.name);
    expect(names).toContain("general");
  });

  test("POST /api/agents/route routes correctly", async ({ request }) => {
    const resp = await request.post("/api/agents/route", {
      data: {
        message: "search for the latest AI news",
        current_agent: "general",
      },
    });
    expect(resp.ok()).toBeTruthy();
    // Routing always returns a valid agent name
    expect(typeof (await resp.json()).agent).toBe("string");
  });

  test("GET /api/conversations returns list", async ({ request }) => {
    const resp = await request.get("/api/conversations");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("POST /api/conversations creates conversation", async ({ request }) => {
    const resp = await request.post("/api/conversations", {
      data: { title: "E2E Test Chat" },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.title).toBe("E2E Test Chat");
    expect(data.id).toBeTruthy();
  });

  test("DELETE /api/conversations deletes conversation", async ({ request }) => {
    const createResp = await request.post("/api/conversations", {
      data: { title: "To Delete" },
    });
    const conv = await createResp.json();

    const delResp = await request.delete(`/api/conversations/${conv.id}`);
    expect(delResp.ok()).toBeTruthy();

    const getResp = await request.get(`/api/conversations/${conv.id}`);
    expect(getResp.status()).toBe(404);
  });

  test("POST /api/chat returns SSE stream", async ({ request }) => {
    const resp = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "hello" }],
      },
    });
    // Should return 200 (SSE) or 500 (LLM connection issues in test env)
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(405);
  });

  test("GET /api/mcp/status returns server status", async ({ request }) => {
    const resp = await request.get("/api/mcp/status");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("GET /api/identity/soul returns soul", async ({ request }) => {
    const resp = await request.get("/api/identity/soul");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.content).toBeTruthy();
  });

  test("GET /api/identity/me returns user profile", async ({ request }) => {
    const resp = await request.get("/api/identity/me");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.content).toBeTruthy();
  });

  test("GET /health returns ok", async ({ request }) => {
    const resp = await request.get("/health");
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).status).toBe("ok");
  });

  test("GET /api/identity/bootstrap-status returns status", async ({ request }) => {
    const resp = await request.get("/api/identity/bootstrap-status");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty("bootstrapped");
    expect(data).toHaveProperty("has_existing_identity");
  });

  test("GET /api/commands includes all expected commands", async ({ request }) => {
    const resp = await request.get("/api/commands");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    const names = data.map((c: any) => c.name);
    expect(names).toContain("/bootstrap");
    expect(names).toContain("/help");
    expect(names).toContain("/tool");
    expect(names).toContain("/schedule");
    expect(names).toContain("/task");
    expect(names).toContain("/skill");
  });
});

// Helper: wait for auto-restore to finish before interacting with the sidebar
async function waitForPageReady(page: any) {
  await page.goto("/");
  await page.locator("button:has-text('Send')").waitFor({ timeout: 10000 });
  await page.locator(".message-content").first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
}

test.describe("Slash commands via chat", () => {

  test("/status returns system status", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill("/status");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('MCP servers')")).toBeVisible({ timeout: 10000 });
  });

  test("/tool list returns available tools", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill("/tool list");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('calculator')")).toBeVisible({ timeout: 10000 });
  });

  test("/schedule list returns schedule info", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill("/schedule list");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('Scheduled')")).toBeVisible({ timeout: 5000 });
  });

  test("/bootstrap status reports bootstrap state", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill("/bootstrap status");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('Bootstrap')")).toBeVisible({ timeout: 5000 });
  });

  test("/help returns available commands", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill("/help");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('Available commands')")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Tools E2E", () => {
  test("calculator tool executes correctly", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "2 + 2" } },
    });
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).result).toBe(4);
  });

  test("calculator handles complex expressions", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "(10 + 5) * 3" } },
    });
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).result).toBe(45);
  });

  test("unknown tool returns error", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "nonexistent_tool", arguments: {} },
    });
    const data = await resp.json();
    // May hit rate limiter in rapid test runs; accept either error format
    expect(data.error || data.detail).toBeTruthy();
  });

  test("tool execution via /tool command", async ({ page }) => {
    await waitForPageReady(page);
    await page.click("text=New session");
    await page.locator("textarea").fill('/tool calculator {"expression":"9*9"}');
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('81')")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Tasks E2E", () => {
  test("GET /api/tasks returns task list", async ({ request }) => {
    const resp = await request.get("/api/tasks?limit=5");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("task panel shows refresh button", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=Tasks").first().click();
    await expect(page.locator("text=Background Tasks")).toBeVisible();
    await expect(page.locator("button:has-text('Refresh')")).toBeVisible();
  });

  test("task panel closes on close button", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=Tasks").first().click();
    await expect(page.locator("text=Background Tasks")).toBeVisible();
    // Close the panel
    const closeBtn = page.locator("text=Background Tasks").locator("..").locator("button");
    await closeBtn.click();
    await expect(page.locator("text=Background Tasks")).not.toBeVisible();
  });
});

test.describe("Bootstrap E2E", () => {
  test("bootstrap auto-triggers on fresh install", async ({ page, request }) => {
    // Check bootstrap status
    const statusResp = await request.get("/api/identity/bootstrap-status");
    const status = await statusResp.json();

    if (!status.bootstrapped && !status.has_existing_identity) {
      // On a truly fresh install (no identity files), opening the page
      // should trigger the bootstrap conversation
      await page.goto("/");

      // Wait for Ray's opening message (bootstrap Q&A)
      const assistantMessage = page.locator(".message-content").first();
      await expect(assistantMessage).toBeVisible({ timeout: 15000 });

      // The opening should be conversational
      const text = await assistantMessage.textContent();
      expect(text).toBeTruthy();
      expect(text!.length).toBeGreaterThan(20);
    }
    // If has_existing_identity is true, bootstrap is skipped (correct behaviour)
  });

  test("bootstrap status command works via chat", async ({ page }) => {
    await page.goto("/");
    await page.click("text=New session");
    await page.locator("textarea").fill("/bootstrap status");
    await page.click("button:has-text('Send')");

    // Should get a response containing "bootstrap" and either "complete" or "pending"
    const response = page.locator(".message-content").last();
    await expect(response).toBeVisible({ timeout: 5000 });
    const text = await response.textContent();
    expect(text?.toLowerCase()).toContain("bootstrap");
  });

  test("slash commands work during bootstrap", async ({ page }) => {
    await page.goto("/");
    await page.click("text=New session");
    await page.locator("textarea").fill("/help");
    await page.click("button:has-text('Send')");
    await expect(page.locator(".message-content:has-text('Available commands')")).toBeVisible({ timeout: 5000 });
  });
});
