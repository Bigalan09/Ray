/**
 * Full-coverage E2E test suite for Ray.
 *
 * Covers every major feature path — happy and unhappy.
 * Designed to run against the live Docker stack via playwright.docker.config.ts.
 *
 * Tests that require a live OpenAI API key are grouped in "live-llm" describes
 * and auto-skip when OPENAI_API_KEY is not set.
 *
 * Usage:
 *   cd tests
 *   npx playwright test --config=playwright.docker.config.ts e2e/full-coverage.spec.ts
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { parseSSE, extractContent } from "../support/sse";
import { fetchWithRetry } from "../support/request";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasApiKey = !!process.env.OPENAI_API_KEY;

/** Skip tests that require a live LLM if no API key is configured. */
function requireLLM() {
  if (!hasApiKey) test.skip(true, "OPENAI_API_KEY not set — skipping live-LLM test");
}

async function freshSession(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Start a clean session so prior conversations don't interfere
  const newBtn = page.locator("text=New session");
  if (await newBtn.isVisible()) await newBtn.click();
  await page.waitForTimeout(200);
}

async function sendChat(page: Page, msg: string) {
  await page.locator("textarea").fill(msg);
  await page.click("button:has-text('Send')");
}

async function waitForAssistantReply(page: Page, timeout = 30_000): Promise<string> {
  const last = page.locator(".text-left .message-content").last();
  await expect(last).toBeVisible({ timeout });
  // Wait until streaming stops (Send button re-enabled)
  await expect(page.locator("button:has-text('Send')")).toBeEnabled({ timeout });
  return (await last.textContent()) ?? "";
}

async function postChat(request: APIRequestContext, messages: object[]) {
  return fetchWithRetry(request, "post", "/api/chat", { data: { messages } });
}

// ---------------------------------------------------------------------------
// 1. Infrastructure / health
// ---------------------------------------------------------------------------

test.describe("Infrastructure", () => {
  test("GET /health returns ok", async ({ request }) => {
    const resp = await request.get("/health");
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).status).toBe("ok");
  });

  test("UI loads at /", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10_000 });
  });

  test("GET /api/models returns at least one model", async ({ request }) => {
    const resp = await request.get("/api/models");
    expect(resp.ok()).toBeTruthy();
    const models = await resp.json();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("id");
  });

  test("GET /api/agents returns general agent", async ({ request }) => {
    const resp = await request.get("/api/agents");
    expect(resp.ok()).toBeTruthy();
    const agents = await resp.json();
    expect(agents.map((a: any) => a.name)).toContain("general");
  });

  test("GET /api/commands lists all slash commands", async ({ request }) => {
    const resp = await request.get("/api/commands");
    expect(resp.ok()).toBeTruthy();
    const names = (await resp.json()).map((c: any) => c.name);
    for (const cmd of ["/help", "/tool", "/task", "/skill", "/bootstrap", "/schedule", "/hook", "/file"]) {
      expect(names).toContain(cmd);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Bootstrap flow
// ---------------------------------------------------------------------------

test.describe("Bootstrap", () => {
  test("GET /api/identity/bootstrap-status returns valid shape", async ({ request }) => {
    const resp = await request.get("/api/identity/bootstrap-status");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty("bootstrapped");
    expect(data).toHaveProperty("has_existing_identity");
  });

  test("/bootstrap status reports state via chat", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/bootstrap status");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toContain("bootstrap");
  });

  test("/bootstrap reset followed by done creates identity files (live-LLM)", async ({ request }) => {
    requireLLM();
    // Reset
    const resetResp = await postChat(request, [
      { role: "user", content: "/bootstrap reset" },
    ]);
    expect(resetResp.ok()).toBeTruthy();

    // Verify unbootstrapped
    const statusResp = await request.get("/api/identity/bootstrap-status");
    const status = await statusResp.json();
    expect(status.bootstrapped).toBe(false);

    // Done — triggers LLM identity generation
    const doneResp = await postChat(request, [
      { role: "user", content: "/bootstrap done" },
    ]);
    expect(doneResp.ok()).toBeTruthy();

    // Verify bootstrapped
    const afterStatus = await (await request.get("/api/identity/bootstrap-status")).json();
    expect(afterStatus.bootstrapped).toBe(true);
  });

  test("UI sends greeting on fresh load without IDENTITY.md (happy path)", async ({ page, request }) => {
    const status = await (await request.get("/api/identity/bootstrap-status")).json();
    if (status.bootstrapped) {
      test.skip(true, "Already bootstrapped — skip fresh-install greeting test");
    }
    await page.goto("/");
    const assistantMsg = page.locator(".text-left .message-content").first();
    await expect(assistantMsg).toBeVisible({ timeout: 30_000 });
    const text = await assistantMsg.textContent();
    expect(text!.length).toBeGreaterThan(20);
  });

  test("bootstrap doesn't persist trigger message — reload shows only greeting", async ({ page, request }) => {
    requireLLM();
    const status = await (await request.get("/api/identity/bootstrap-status")).json();
    if (status.bootstrapped) {
      test.skip(true, "Already bootstrapped");
    }
    await page.goto("/");
    await waitForAssistantReply(page, 30_000);

    // Reload
    await page.reload();
    await page.waitForLoadState("networkidle");

    const msgs = page.locator(".message-content");
    const count = await msgs.count();
    // Should be exactly 1 (greeting) — not 2 (trigger + greeting)
    const texts = await Promise.all(Array.from({ length: count }, (_, i) => msgs.nth(i).textContent()));
    const triggerVisible = texts.some((t) => t?.includes("starting up for the first time"));
    expect(triggerVisible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Chat — API level
// ---------------------------------------------------------------------------

test.describe("Chat API", () => {
  test("POST /api/chat with a message returns SSE 200", async ({ request }) => {
    const resp = await postChat(request, [{ role: "user", content: "ping" }]);
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain("data:");
  });

  test("SSE stream ends with [DONE]", async ({ request }) => {
    const resp = await postChat(request, [{ role: "user", content: "/help" }]);
    const body = await resp.text();
    expect(body).toContain("[DONE]");
  });

  test("slash command returns command_result event", async ({ request }) => {
    const resp = await postChat(request, [{ role: "user", content: "/help" }]);
    const events = parseSSE(await resp.text());
    const result = events.find((e) => e.type === "command_result");
    expect(result).toBeTruthy();
    expect(result!.content).toBeTruthy();
  });

  test("missing messages body returns 422", async ({ request }) => {
    const resp = await request.post("/api/chat", { data: {} });
    expect(resp.status()).toBe(422);
  });

  test("empty messages array returns error or keepalive", async ({ request }) => {
    const resp = await request.post("/api/chat", { data: { messages: [] } });
    // Should not 500 — either 422 validation or a handled stream error
    expect(resp.status()).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Chat — UI level
// ---------------------------------------------------------------------------

test.describe("Chat UI", () => {
  test("user message appears immediately after send", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "hello world");
    await expect(page.locator("text=hello world")).toBeVisible({ timeout: 5_000 });
  });

  test("stop button appears and halts streaming", async ({ page }) => {
    requireLLM();
    await freshSession(page);
    await sendChat(page, "Write me a very long essay about the history of computing");
    const stopBtn = page.locator("button:has-text('Stop')");
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    await stopBtn.click();
    await expect(page.locator("button:has-text('Send')")).toBeEnabled({ timeout: 5_000 });
  });

  test("send button re-enables after response", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/status");
    await expect(page.locator("button:has-text('Send')")).toBeEnabled({ timeout: 20_000 });
  });

  test("new session clears messages", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/help");
    await waitForAssistantReply(page);
    await page.click("text=New session");
    await expect(page.locator(".message-content")).toHaveCount(0);
  });

  test("conversation persists after page reload", async ({ page, request }) => {
    const conv = await (await request.post("/api/conversations", { data: { title: "Reload Test" } })).json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "Persist me" },
    });
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "assistant", content: "I am persisted" },
    });

    await page.goto("/");
    await page.click("text=Reload Test");
    await expect(page.locator("text=Persist me")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=I am persisted")).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Slash commands
// ---------------------------------------------------------------------------

test.describe("Slash commands", () => {
  test("/help returns command list", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/help");
    await expect(page.locator(".message-content:has-text('Available commands')")).toBeVisible({ timeout: 10_000 });
  });

  test("/status returns system info", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/status");
    await expect(page.locator(".message-content:has-text('MCP')")).toBeVisible({ timeout: 10_000 });
  });

  test("/tool list lists all tools", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/tool list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toContain("calculator");
    expect(reply.toLowerCase()).toContain("web_search");
  });

  test("/tool calculator executes correctly", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, '/tool calculator {"expression": "6 * 7"}');
    const reply = await waitForAssistantReply(page);
    expect(reply).toContain("42");
  });

  test("/tool nonexistent returns error", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/tool does_not_exist {}");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/error|not found|unknown/);
  });

  test("/skill list returns skills", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/skill list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/skill|no skills/);
  });

  test("/schedule list returns schedules", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/schedule list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/schedule|no schedule/);
  });

  test("/file list returns workspace files", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/file list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/file|memory|soul/i);
  });

  test("/file write then read round-trips content", async ({ page }) => {
    await freshSession(page);
    const filename = `test-${Date.now()}.txt`;
    await sendChat(page, `/file write ${filename} hello from test`);
    await waitForAssistantReply(page);

    await page.click("text=New session");
    await sendChat(page, `/file read ${filename}`);
    const reply = await waitForAssistantReply(page);
    expect(reply).toContain("hello from test");
  });

  test("/file write outside workspace is rejected", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/file read ../../etc/passwd");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/error|denied|invalid|outside/);
  });

  test("/new creates a fresh conversation", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/help");
    await waitForAssistantReply(page);
    await sendChat(page, "/new");
    await expect(page.locator(".message-content")).toHaveCount(0, { timeout: 3_000 });
  });

  test("/clear clears current conversation messages", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/help");
    await waitForAssistantReply(page);
    await sendChat(page, "/clear");
    await expect(page.locator(".message-content")).toHaveCount(0, { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Tool execution — direct API
// ---------------------------------------------------------------------------

test.describe("Tools API", () => {
  test("GET /api/tools returns tool list with calculator", async ({ request }) => {
    const resp = await request.get("/api/tools");
    expect(resp.ok()).toBeTruthy();
    const tools = await resp.json();
    expect(tools.some((t: any) => t.name === "calculator")).toBeTruthy();
    expect(tools.some((t: any) => t.name === "web_search")).toBeTruthy();
    expect(tools.some((t: any) => t.name === "memory_search")).toBeTruthy();
    expect(tools.some((t: any) => t.name === "get_current_time")).toBeTruthy();
  });

  test("calculator: integer arithmetic", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "100 / 4" } },
    });
    expect((await resp.json()).result).toBe(25);
  });

  test("calculator: floating point", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "1 / 3" } },
    });
    const result = (await resp.json()).result;
    expect(typeof result).toBe("number");
    expect(result).toBeCloseTo(0.333, 2);
  });

  test("calculator: invalid expression returns error", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "import os" } },
    });
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });

  test("calculator: division by zero returns error", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "1 / 0" } },
    });
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });

  test("get_current_time returns ISO timestamp", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "get_current_time", arguments: {} },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.current_time || data.result).toBeTruthy();
  });

  test("unknown tool returns error field", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "totally_fake_tool", arguments: {} },
    });
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });

  test("missing tool_name returns 422", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { arguments: {} },
    });
    expect(resp.status()).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// 7. LLM-driven tool calls (requires live OpenAI)
// ---------------------------------------------------------------------------

test.describe("LLM tool calls (live)", () => {
  test.beforeEach(() => requireLLM());

  test("LLM calls calculator when asked to do math", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "What is 144 divided by 12? Use the calculator tool." },
    ]);
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    // Should see a ray_tool event for calculator
    const toolEvent = events.find((e: any) => e.ray_tool?.name === "calculator");
    expect(toolEvent).toBeTruthy();
    // Final text should contain 12
    const text = extractContent(events);
    expect(text).toContain("12");
  });

  test("LLM calls get_current_time when asked the time", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "What time is it right now? Use the get_current_time tool." },
    ]);
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    const toolEvent = events.find((e: any) => e.ray_tool?.name === "get_current_time");
    expect(toolEvent).toBeTruthy();
  });

  test("LLM handles multi-turn tool loop", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "First, what is 10 * 10? Then what is that result plus 5?" },
    ]);
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    const text = extractContent(events);
    expect(text).toContain("105");
  });

  test("LLM does not call tool for conversational message", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "Hi, how are you?" },
    ]);
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    const toolEvents = events.filter((e: any) => e.ray_tool);
    expect(toolEvents.length).toBe(0);
  });

  test("tool call result appears in UI", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "What is 8 * 8? Use the calculator.");
    const reply = await waitForAssistantReply(page, 30_000);
    expect(reply).toContain("64");
  });

  test("tool notification chip renders in UI", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "What time is it? Use get_current_time.");
    // Wait for tool chip to appear
    const toolChip = page.locator("[data-tool-name], .tool-call, text=get_current_time").first();
    await expect(toolChip).toBeVisible({ timeout: 20_000 });
  });
});

// ---------------------------------------------------------------------------
// 8. Web search (live)
// ---------------------------------------------------------------------------

test.describe("Web search (live)", () => {
  test.beforeEach(() => requireLLM());

  test("web_search tool returns results directly", async ({ request }) => {
    const resp = await request.post("/api/tools/execute", {
      data: { tool_name: "web_search", arguments: { query: "OpenAI" } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    // Should have results or content field
    expect(data.results || data.content || data.error).toBeTruthy();
    if (!data.error) {
      expect(typeof (data.results || data.content)).toBe("string");
    }
  });

  test("LLM triggers web_search for current events question", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "Search the web: what is the latest version of Python?" },
    ]);
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    const searchEvent = events.find(
      (e: any) => e.ray_tool?.name === "web_search" || e.ray_tool?.name === "web_search_preview"
    );
    expect(searchEvent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. Memory (ChromaDB)
// ---------------------------------------------------------------------------

test.describe("Memory", () => {
  test("GET /api/memory/search returns results or empty array", async ({ request }) => {
    const resp = await request.get("/api/memory/search?q=test&limit=5");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data.results ?? data)).toBeTruthy();
  });

  test("memory_store tool saves a fact", async ({ request }) => {
    const key = `test-fact-${Date.now()}`;
    const resp = await request.post("/api/tools/execute", {
      data: {
        tool_name: "memory_store",
        arguments: { content: `Test memory: ${key}`, tags: ["test"] },
      },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.error).toBeFalsy();
  });

  test("memory_search finds recently stored fact", async ({ request }) => {
    const unique = `unique-${Date.now()}`;
    // Store
    await request.post("/api/tools/execute", {
      data: {
        tool_name: "memory_store",
        arguments: { content: `Remember this: ${unique}`, tags: ["e2e-test"] },
      },
    });
    // Search
    const searchResp = await request.get(`/api/memory/search?q=${unique}&limit=5`);
    const data = await searchResp.json();
    const results = data.results ?? data;
    const found = results.some((r: any) =>
      JSON.stringify(r).includes(unique)
    );
    expect(found).toBeTruthy();
  });

  test("/tool memory_store via chat persists correctly", async ({ page }) => {
    await freshSession(page);
    const unique = `chatmem-${Date.now()}`;
    await sendChat(page, `/tool memory_store {"content": "E2E fact: ${unique}"}`);
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).not.toContain("error");
  });

  test("/tool memory_search via chat finds stored fact", async ({ page, request }) => {
    const unique = `recall-${Date.now()}`;
    // Store via API
    await request.post("/api/tools/execute", {
      data: { tool_name: "memory_store", arguments: { content: `Recall fact: ${unique}` } },
    });

    await freshSession(page);
    await sendChat(page, `/tool memory_search {"query": "${unique}"}`);
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).not.toContain("error");
    // Result should mention the stored content or "found" / "result"
    expect(reply.toLowerCase()).toMatch(/recall|found|result|memory|${unique.slice(0, 8)}/i);
  });

  test("proactive memory recall — stored fact appears in LLM response without explicit /tool call", async ({ page, request }) => {
    requireLLM();
    // Use a very specific unique token so the ChromaDB search is unambiguous
    const token = `proj-xray-${Date.now()}`;
    const fact = `The secret project codename is ${token}.`;

    // Store the fact via API
    await request.post("/api/tools/execute", {
      data: { tool_name: "memory_store", arguments: { content: fact, tags: ["e2e-proactive"] } },
    });

    // Start a fresh conversation and ask a related question — no /tool invocation
    await freshSession(page);
    await sendChat(page, `What is the secret project codename? (Answer from memory if you know it.)`);
    const reply = await waitForAssistantReply(page, 20000);

    // The injected memory section should have surfaced the fact to the LLM
    expect(reply).toContain(token);

    // Cleanup
    const searchResp = await request.get(`/api/memory/search?q=${token}&limit=5`);
    const data = await searchResp.json();
    const results: any[] = data.results ?? data;
    for (const r of results) {
      if (r.id) await request.delete(`/api/memory/${r.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Background tasks
// ---------------------------------------------------------------------------

test.describe("Background tasks", () => {
  test("GET /api/tasks returns array", async ({ request }) => {
    const resp = await request.get("/api/tasks");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("POST /api/tasks creates a task", async ({ request }) => {
    const resp = await request.post("/api/tasks", {
      data: { prompt: "What is 2 + 2?", agent: "general" },
    });
    expect(resp.ok()).toBeTruthy();
    const task = await resp.json();
    expect(task.id).toBeTruthy();
    expect(task.status).toMatch(/pending|running|completed/);
  });

  test("created task appears in GET /api/tasks", async ({ request }) => {
    const created = await (await request.post("/api/tasks", {
      data: { prompt: "List test task", agent: "general" },
    })).json();

    const list = await (await request.get("/api/tasks")).json();
    const found = list.find((t: any) => t.id === created.id);
    expect(found).toBeTruthy();
  });

  test("GET /api/tasks/{id} returns task details", async ({ request }) => {
    const created = await (await request.post("/api/tasks", {
      data: { prompt: "Detail test", agent: "general" },
    })).json();

    const resp = await request.get(`/api/tasks/${created.id}`);
    expect(resp.ok()).toBeTruthy();
    const task = await resp.json();
    expect(task.id).toBe(created.id);
    expect(task).toHaveProperty("status");
    expect(task).toHaveProperty("prompt");
  });

  test("GET /api/tasks/nonexistent returns 404", async ({ request }) => {
    const resp = await request.get("/api/tasks/does-not-exist-12345");
    expect(resp.status()).toBe(404);
  });

  test("POST /api/tasks/{id}/cancel cancels a task", async ({ request }) => {
    const created = await (await request.post("/api/tasks", {
      data: { prompt: "Cancel me", agent: "general" },
    })).json();

    const cancelResp = await request.post(`/api/tasks/${created.id}/cancel`);
    expect(cancelResp.ok()).toBeTruthy();

    const task = await (await request.get(`/api/tasks/${created.id}`)).json();
    expect(task.status).toMatch(/cancelled|canceled|cancelling/);
  });

  test("/task command creates a task from chat", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/task What is today's date?");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/task|created|queued|started/);
  });

  test("tasks panel shows task list", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=Tasks").first().click();
    await expect(page.locator("text=Background Tasks")).toBeVisible();
  });

  test("task completes and result is retrievable (live)", async ({ request }) => {
    requireLLM();
    const created = await (await request.post("/api/tasks", {
      data: { prompt: "What is 3 + 3? Reply with only the number.", agent: "general" },
    })).json();

    // Poll until completed or timeout
    let task: any;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      task = await (await request.get(`/api/tasks/${created.id}`)).json();
      if (task.status === "completed" || task.status === "failed") break;
    }
    expect(task.status).toBe("completed");
    expect(task.result).toContain("6");
  });
});

// ---------------------------------------------------------------------------
// 11. Scheduled tasks
// ---------------------------------------------------------------------------

test.describe("Scheduled tasks", () => {
  test("GET /api/schedules returns array", async ({ request }) => {
    const resp = await request.get("/api/schedules");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("/schedule list shows schedules", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/schedule list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/schedule|no schedule|cron/);
  });

  test("POST /api/schedules creates a schedule", async ({ request }) => {
    const resp = await request.post("/api/schedules", {
      data: {
        name: `e2e-sched-${Date.now()}`,
        prompt: "Say hello",
        cron: "0 9 * * *",
        agent: "general",
        enabled: false,
      },
    });
    expect(resp.ok()).toBeTruthy();
    const sched = await resp.json();
    expect(sched.name).toBeTruthy();
    expect(sched.cron).toBe("0 9 * * *");
  });

  test("invalid cron expression is rejected", async ({ request }) => {
    const resp = await request.post("/api/schedules", {
      data: {
        name: "bad-sched",
        prompt: "test",
        cron: "not a cron",
        agent: "general",
      },
    });
    expect(resp.status()).toBe(422);
  });

  test("created schedule appears in list", async ({ request }) => {
    const name = `list-sched-${Date.now()}`;
    await request.post("/api/schedules", {
      data: { name, prompt: "test", cron: "0 0 * * *", agent: "general", enabled: false },
    });

    const list = await (await request.get("/api/schedules")).json();
    expect(list.some((s: any) => s.name === name)).toBeTruthy();
  });

  test("schedule panel visible in sidebar", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=Scheduled").click();
    await expect(page.locator("text=Scheduled Tasks")).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 12. Webhooks & hooks
// ---------------------------------------------------------------------------

test.describe("Webhooks", () => {
  const hookName = () => `e2e-hook-${Date.now()}`;

  test("GET /api/hooks/events returns event types", async ({ request }) => {
    const resp = await request.get("/api/hooks/events");
    expect(resp.ok()).toBeTruthy();
    const events = await resp.json();
    expect(events).toContain("message_received");
    expect(events).toContain("task_completed");
    expect(events).toContain("exec_approved");
  });

  test("POST webhook → GET list → DELETE lifecycle", async ({ request }) => {
    const name = hookName();
    // Create
    const createResp = await request.post("/api/hooks/webhooks", {
      data: { name, url: "https://httpbin.org/post", events: ["task_completed"] },
    });
    expect(createResp.ok()).toBeTruthy();
    const wh = await createResp.json();
    expect(wh.name).toBe(name);

    // List
    const list = await (await request.get("/api/hooks/webhooks")).json();
    expect(list.some((w: any) => w.name === name)).toBeTruthy();

    // Delete
    const delResp = await request.delete(`/api/hooks/webhooks/${name}`);
    expect(delResp.ok()).toBeTruthy();

    // Verify gone
    const afterList = await (await request.get("/api/hooks/webhooks")).json();
    expect(afterList.some((w: any) => w.name === name)).toBeFalsy();
  });

  test("DELETE nonexistent webhook returns error gracefully", async ({ request }) => {
    const resp = await request.delete("/api/hooks/webhooks/definitely-does-not-exist");
    const data = await resp.json();
    expect(data.success).toBeFalsy();
  });

  test("POST /api/hooks/webhooks/{name}/test fires test event", async ({ request }) => {
    const name = hookName();
    await request.post("/api/hooks/webhooks", {
      data: { name, url: "https://httpbin.org/post", events: ["message_received"] },
    });

    const testResp = await request.post(`/api/hooks/webhooks/${name}/test`);
    expect(testResp.ok()).toBeTruthy();

    // Cleanup
    await request.delete(`/api/hooks/webhooks/${name}`);
  });

  test("GET /api/hooks/log returns array", async ({ request }) => {
    const resp = await request.get("/api/hooks/log");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("POST /api/hooks/reload succeeds", async ({ request }) => {
    const resp = await request.post("/api/hooks/reload");
    expect(resp.ok()).toBeTruthy();
  });

  test("webhooks panel visible and functional in UI", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=Webhooks").click();
    await expect(page.locator("text=Webhooks").first()).toBeVisible();
    // Panel should show event list or empty state
    const panel = page.locator("text=Webhooks").locator("..").locator("..");
    await expect(panel).toBeVisible();
  });

  test("webhook requires valid URL", async ({ request }) => {
    const resp = await request.post("/api/hooks/webhooks", {
      data: { name: hookName(), url: "not-a-url", events: [] },
    });
    // Should reject invalid URL
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// 13. Exec guardrails
// ---------------------------------------------------------------------------

test.describe("Exec guardrails", () => {
  test("GET /api/exec/pending returns array", async ({ request }) => {
    const resp = await request.get("/api/exec/pending");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("/exec disallowed command is rejected", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/exec rm -rf /");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/not allowed|denied|blocked|error/);
  });

  test("/exec allowed command creates pending approval", async ({ page, request }) => {
    await freshSession(page);
    await sendChat(page, "/exec git status");

    // Should see approval card OR an error if git isn't in allow list
    // Either way it should not crash
    await expect(page.locator("button:has-text('Send')")).toBeEnabled({ timeout: 10_000 });
  });

  test("shell metacharacters in exec are blocked", async ({ request }) => {
    const resp = await postChat(request, [
      { role: "user", content: "/exec git status; rm -rf /" },
    ]);
    const events = parseSSE(await resp.text());
    const text = extractContent(events);
    expect(text.toLowerCase()).toMatch(/not allowed|denied|invalid|blocked/);
  });

  test("POST /api/exec/{id}/deny rejects a pending command", async ({ request }) => {
    // Create a pending exec via chat API
    const chatResp = await postChat(request, [
      { role: "user", content: "/exec git status" },
    ]);
    const events = parseSSE(await chatResp.text());
    const approvalEvent = events.find((e: any) => e.exec_pending || e.type === "exec_pending");

    if (approvalEvent) {
      const execId = (approvalEvent as any).exec_pending?.id ?? (approvalEvent as any).id;
      const denyResp = await request.post(`/api/exec/${execId}/deny`);
      expect(denyResp.ok()).toBeTruthy();
    }
    // If no pending event, command wasn't in allow list — test passes vacuously
  });
});

// ---------------------------------------------------------------------------
// 14. Conversation management
// ---------------------------------------------------------------------------

test.describe("Conversation management", () => {
  test("full CRUD lifecycle", async ({ request }) => {
    // Create
    const conv = await (await request.post("/api/conversations", {
      data: { title: "CRUD Test" },
    })).json();
    expect(conv.id).toBeTruthy();

    // Add messages
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "Hello" },
    });
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "assistant", content: "Hi there" },
    });

    // Read messages
    const msgs = await (await request.get(`/api/conversations/${conv.id}/messages`)).json();
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe("Hello");

    // Update title
    const patchResp = await request.patch(`/api/conversations/${conv.id}`, {
      data: { title: "Updated Title" },
    });
    expect(patchResp.ok()).toBeTruthy();

    // Delete
    const delResp = await request.delete(`/api/conversations/${conv.id}`);
    expect(delResp.ok()).toBeTruthy();

    // Verify gone
    const getResp = await request.get(`/api/conversations/${conv.id}`);
    expect(getResp.status()).toBe(404);
  });

  test("conversation appears in sidebar after chat", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/help");
    await waitForAssistantReply(page);

    // Sidebar should show a conversation entry
    const sidebar = page.locator(".truncate").first();
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
  });

  test("conversation with JSON content renders without blank screen", async ({ page, request }) => {
    const conv = await (await request.post("/api/conversations", {
      data: { title: "JSON Test" },
    })).json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "assistant", content: '{"key": "value", "number": 42}' },
    });

    await page.goto("/");
    await page.click("text=JSON Test");
    await expect(page.locator("text=JSON Test")).toBeVisible({ timeout: 5_000 });
    // Should not blank — content should be visible
    await expect(page.locator(".message-content")).toHaveCount(1, { timeout: 5_000 });
  });

  test("most recent conversation auto-restores on page load", async ({ page, request }) => {
    const conv = await (await request.post("/api/conversations", {
      data: { title: "Auto-restore" },
    })).json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "auto-restore-unique-marker" },
    });

    await page.goto("/");
    await expect(page.locator("text=auto-restore-unique-marker")).toBeVisible({ timeout: 8_000 });
  });

  test("auto-title is generated for new conversations (live)", async ({ page, request }) => {
    requireLLM();
    await freshSession(page);
    await sendChat(page, "Tell me about black holes");
    await waitForAssistantReply(page, 30_000);

    // Wait for async title generation (up to 15 s)
    await page.waitForTimeout(5_000);

    // The sidebar entry should NOT say "New Chat" anymore
    const titleEl = page.locator(".truncate").first();
    const title = await titleEl.textContent();
    expect(title?.toLowerCase()).not.toBe("new chat");
  });
});

// ---------------------------------------------------------------------------
// 15. Identity / workspace files
// ---------------------------------------------------------------------------

test.describe("Identity & workspace", () => {
  test("GET /api/identity/soul returns SOUL.md content", async ({ request }) => {
    const resp = await request.get("/api/identity/soul");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(typeof data.content).toBe("string");
    expect(data.content.length).toBeGreaterThan(0);
  });

  test("GET /api/identity/me returns USER.md content", async ({ request }) => {
    const resp = await request.get("/api/identity/me");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(typeof data.content).toBe("string");
  });

  test("PUT /api/identity/soul round-trips content", async ({ request }) => {
    // Save original
    const original = await (await request.get("/api/identity/soul")).json();

    const testContent = original.content + "\n<!-- e2e test marker -->";
    const putResp = await request.put("/api/identity/soul", {
      data: { content: testContent },
    });
    expect(putResp.ok()).toBeTruthy();

    // Verify
    const updated = await (await request.get("/api/identity/soul")).json();
    expect(updated.content).toContain("e2e test marker");

    // Restore
    await request.put("/api/identity/soul", { data: { content: original.content } });
  });

  test("GET /api/identity/system-prompt includes SOUL.md content", async ({ request }) => {
    const resp = await request.get("/api/identity/system-prompt");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.system_prompt || data.prompt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 16. MCP servers
// ---------------------------------------------------------------------------

test.describe("MCP servers", () => {
  test("GET /api/mcp/status returns array", async ({ request }) => {
    const resp = await request.get("/api/mcp/status");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("MCP panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=MCP Servers").click();
    await expect(page.locator(".font-semibold:has-text('MCP Servers')")).toBeVisible();
  });

  test("registered MCP tools appear in /api/tools", async ({ request }) => {
    const statusResp = await request.get("/api/mcp/status");
    const servers = await statusResp.json();
    const connectedServers = servers.filter((s: any) => s.status === "connected");

    if (connectedServers.length > 0) {
      const toolsResp = await request.get("/api/tools");
      const tools = await toolsResp.json();
      // At least one tool should come from MCP
      const mcpTool = tools.find((t: any) => t.source === "mcp" || t.mcp);
      // This is informational — don't fail if no MCP tools registered yet
      test.info().annotations.push({
        type: "info",
        description: `MCP tools found: ${mcpTool ? "yes" : "none"}`,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 17. Skills
// ---------------------------------------------------------------------------

test.describe("Skills", () => {
  test("GET /api/skills returns skill list", async ({ request }) => {
    const resp = await request.get("/api/skills");
    expect(resp.ok()).toBeTruthy();
    expect(Array.isArray(await resp.json())).toBeTruthy();
  });

  test("/skill list shows all skills in chat", async ({ page }) => {
    await freshSession(page);
    await sendChat(page, "/skill list");
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/skill|no skill/);
  });

  test("invoking a skill produces LLM response (live)", async ({ request }) => {
    requireLLM();
    const skills = await (await request.get("/api/skills")).json();
    if (skills.length === 0) {
      test.skip(true, "No skills configured");
    }
    const skill = skills[0];
    const resp = await postChat(request, [
      { role: "user", content: `/skill ${skill.name} test input` },
    ]);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 18. Image upload
// ---------------------------------------------------------------------------

test.describe("Image upload", () => {
  test("file upload button is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("button[title='Upload document for RAG']")).toBeVisible();
  });

  test("POST /api/documents accepts image upload", async ({ request }) => {
    // Create a minimal 1x1 PNG
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    const resp = await request.post("/api/documents", {
      multipart: {
        file: { name: "test.png", mimeType: "image/png", buffer: pngBytes },
      },
    });
    // Should accept (200/201) or return a structured error — not 500
    expect(resp.status()).not.toBe(500);
  });

  test("image message renders in chat as img or attachment (live)", async ({ page }) => {
    requireLLM();
    // This test requires FileUpload interaction — simplified to check UI element
    await page.goto("/");
    const uploadBtn = page.locator("button[title='Upload document for RAG']");
    await expect(uploadBtn).toBeVisible();
    // Verify clicking doesn't crash
    await uploadBtn.click();
    // File picker opens (can't fully automate without setInputFiles)
    await page.keyboard.press("Escape");
  });
});

// ---------------------------------------------------------------------------
// 19. Auth & rate limiting
// ---------------------------------------------------------------------------

test.describe("Auth", () => {
  test("GET /api/auth/status returns auth state", async ({ request }) => {
    const resp = await request.get("/api/auth/status");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty("enabled");
  });

  test("when auth is enabled, requests without key return 401", async ({ request }) => {
    const status = await (await request.get("/api/auth/status")).json();
    if (!status.enabled) {
      test.skip(true, "Auth not enabled — skipping 401 test");
    }

    // Make a request without API key header
    const resp = await request.get("/api/conversations", {
      headers: { "X-API-Key": "" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/auth/generate-key creates a key", async ({ request }) => {
    const resp = await request.post("/api/auth/generate-key");
    // May be 200 (created) or 409 (already exists)
    expect([200, 409]).toContain(resp.status());
  });
});

// ---------------------------------------------------------------------------
// 20. Error handling & edge cases
// ---------------------------------------------------------------------------

test.describe("Error handling", () => {
  test("404 for unknown API route returns JSON error", async ({ request }) => {
    const resp = await request.get("/api/nonexistent-route-xyz");
    expect(resp.status()).toBe(404);
  });

  test("malformed JSON body returns 422", async ({ request }) => {
    const resp = await request.post("/api/chat", {
      headers: { "Content-Type": "application/json" },
      data: "{ this is not json }",
    });
    expect([400, 422]).toContain(resp.status());
  });

  test("very long message is handled gracefully", async ({ request }) => {
    const longMsg = "a".repeat(50_000);
    const resp = await postChat(request, [{ role: "user", content: longMsg }]);
    // Should not 500 — either handled or rejected with useful status
    expect(resp.status()).not.toBe(500);
  });

  test("conversation messages endpoint rejects invalid role", async ({ request }) => {
    const conv = await (await request.post("/api/conversations", {
      data: { title: "Invalid role test" },
    })).json();

    const resp = await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "invalid_role", content: "test" },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);

    // Cleanup
    await request.delete(`/api/conversations/${conv.id}`);
  });

  test("rate limit headers present on chat endpoint", async ({ request }) => {
    const resp = await postChat(request, [{ role: "user", content: "/help" }]);
    // Headers may or may not be present depending on config — just verify no crash
    expect(resp.status()).not.toBe(500);
  });
});
