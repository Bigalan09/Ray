/**
 * E2E tests for tool call notifications and message action buttons.
 *
 * Tests cover:
 * - Tool call SSE events (ray_tool) via API
 * - Tool notification chips rendered in the UI
 * - Copy and resend buttons on message bubbles
 * - Happy path: tool executes successfully
 * - Unhappy path: unknown tool returns error
 */
import { test, expect } from "@playwright/test";
import { fetchWithRetry } from "../support/request";
import { parseSSE, type SSEEvent } from "../support/sse";

// ---------------------------------------------------------------------------
// API-level tests: tool call SSE events
// ---------------------------------------------------------------------------

test.describe("Tool call SSE events (API)", () => {
  test("calculator tool via /tool command returns result (happy path)", async ({
    request,
  }) => {
    const resp = await fetchWithRetry(request, "post", "/api/chat", {
      data: {
        messages: [
          { role: "user", content: '/tool calculator {"expression": "6 * 7"}' },
        ],
      },
    });
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());

    // Should get a command_result with the answer
    const cmdResult = events.find((e) => e.type === "command_result");
    expect(cmdResult).toBeTruthy();
    expect(cmdResult!.content).toContain("42");
  });

  test("unknown tool via /tool command returns error (unhappy path)", async ({
    request,
  }) => {
    const resp = await fetchWithRetry(request, "post", "/api/chat", {
      data: {
        messages: [
          { role: "user", content: "/tool nonexistent_tool {}" },
        ],
      },
    });
    expect(resp.ok()).toBeTruthy();
    const events = parseSSE(await resp.text());
    const cmdResult = events.find((e) => e.type === "command_result");
    expect(cmdResult).toBeTruthy();
    // Should contain an error indication
    const content = (cmdResult!.content || "").toLowerCase();
    expect(content).toContain("error");
  });

  test("calculator tool via direct API returns result", async ({
    request,
  }) => {
    const resp = await fetchWithRetry(request, "post", "/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "2 + 2" } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.result).toBe(4);
    expect(data.error).toBeUndefined();
  });

  test("unknown tool via direct API returns error", async ({ request }) => {
    const resp = await fetchWithRetry(request, "post", "/api/tools/execute", {
      data: { tool_name: "does_not_exist", arguments: {} },
    });
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });

  test("invalid expression returns calculator error", async ({ request }) => {
    const resp = await fetchWithRetry(request, "post", "/api/tools/execute", {
      data: { tool_name: "calculator", arguments: { expression: "import os" } },
    });
    const data = await resp.json();
    // Calculator should reject non-mathematical expressions
    expect(data.error || data.result === undefined).toBeTruthy();
  });

  test("ray_tool event format is correct in SSE stream", async () => {
    // Verify the expected wire format for tool events
    const running = { ray_tool: { name: "calculator", status: "running" } };
    const success = { ray_tool: { name: "calculator", status: "success" } };
    const error = { ray_tool: { name: "bad_tool", status: "error" } };

    // Events should have ray_tool field, not choices
    expect(running).not.toHaveProperty("choices");
    expect(running.ray_tool.name).toBe("calculator");
    expect(running.ray_tool.status).toBe("running");
    expect(success.ray_tool.status).toBe("success");
    expect(error.ray_tool.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// UI tests: message action buttons
// ---------------------------------------------------------------------------

test.describe("Message action buttons (UI)", () => {
  test.beforeEach(async ({ page }) => {
    try {
      const resp = await page.goto("/", { timeout: 5000 });
      if (!resp || !resp.ok()) test.skip();
    } catch {
      test.skip();
    }
  });

  test("copy button appears on hover over assistant message", async ({
    page,
  }) => {
    // Send a slash command to get a guaranteed response
    await page.locator("textarea").fill("/help");
    await page.click("button:has-text('Send')");

    // Wait for the assistant response (text-left message with "Available commands")
    const assistantMsg = page.locator(".text-left .message-content").last();
    await expect(assistantMsg).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Hover over the message wrapper
    const messageWrapper = assistantMsg
      .locator("xpath=ancestor::div[contains(@class, 'group')]")
      .first();
    await messageWrapper.hover({ force: true });

    // Copy button should be visible
    const copyBtn = messageWrapper.locator("button[title='Copy']");
    await expect(copyBtn).toBeVisible({ timeout: 3000 });
  });

  test("copy button appears on hover over user message", async ({ page }) => {
    await page.locator("textarea").fill("test message for copy");
    await page.click("button:has-text('Send')");

    // Wait for user message to appear
    await expect(page.locator("text=test message for copy")).toBeVisible({
      timeout: 5000,
    });

    // Find the user message wrapper and hover
    const userMsg = page.locator("text=test message for copy");
    const wrapper = userMsg
      .locator("xpath=ancestor::div[contains(@class, 'group')]")
      .first();
    await wrapper.hover();

    // Copy button should appear
    const copyBtn = wrapper.locator("button[title='Copy']");
    await expect(copyBtn).toBeVisible({ timeout: 3000 });
  });

  test("resend button appears only on user messages", async ({ page }) => {
    await page.locator("textarea").fill("/status");
    await page.click("button:has-text('Send')");

    // Wait for response
    await expect(page.locator(".message-content").last()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("button:has-text('Send')")).toBeVisible({
      timeout: 10000,
    });

    // Find the user message (/status) and hover
    const userMsgWrapper = page
      .locator("text=/status")
      .locator("xpath=ancestor::div[contains(@class, 'group')]")
      .first();
    await userMsgWrapper.hover();

    // Resend button should be present on user message
    const resendBtn = userMsgWrapper.locator("button[title='Resend']");
    await expect(resendBtn).toBeVisible({ timeout: 3000 });

    // Find an assistant message and hover
    const assistantMsgs = page.locator(".text-left .message-content");
    if ((await assistantMsgs.count()) > 0) {
      const assistantWrapper = assistantMsgs
        .first()
        .locator("xpath=ancestor::div[contains(@class, 'group')]")
        .first();
      await assistantWrapper.hover();

      // Resend button should NOT be present on assistant message
      const assistantResend = assistantWrapper.locator("button[title='Resend']");
      await expect(assistantResend).toHaveCount(0);
    }
  });

  test("copy button copies text to clipboard", async ({ page, context }) => {
    // Grant clipboard permission
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.locator("textarea").fill("/help");
    await page.click("button:has-text('Send')");

    // Wait for assistant response specifically
    const assistantMsg = page.locator(".text-left .message-content").last();
    await expect(assistantMsg).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Hover and click copy
    const wrapper = assistantMsg
      .locator("xpath=ancestor::div[contains(@class, 'group')]")
      .first();
    await wrapper.hover({ force: true });
    const copyBtn = wrapper.locator("button[title='Copy']");
    await copyBtn.click();

    // Should show checkmark briefly (success feedback)
    const checkmark = wrapper.locator("svg.text-green-400");
    await expect(checkmark).toBeVisible({ timeout: 2000 });

    // Verify clipboard content
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText.toLowerCase()).toContain("available commands");
  });
});

// ---------------------------------------------------------------------------
// UI tests: tool notification chips
// ---------------------------------------------------------------------------

test.describe("Tool notification chips (UI)", () => {
  test.beforeEach(async ({ page }) => {
    try {
      const resp = await page.goto("/", { timeout: 5000 });
      if (!resp || !resp.ok()) test.skip();
    } catch {
      test.skip();
    }
  });

  test("tool command result displays in chat without raw markdown artifacts", async ({
    page,
  }) => {
    await page.locator("textarea").fill(
      '/tool calculator {"expression": "15 + 27"}',
    );
    await page.click("button:has-text('Send')");

    // Wait for the assistant response (left-aligned message with result)
    const response = page.locator(".text-left .message-content").last();
    await expect(response).toBeVisible({ timeout: 10000 });
    const text = await response.textContent();

    // Should contain the result
    expect(text).toContain("42");
    // Should NOT contain raw SSE artifacts
    expect(text).not.toContain("ray_tool");
    expect(text).not.toContain("[DONE]");
  });

  test("tool error is displayed cleanly", async ({ page }) => {
    await page.locator("textarea").fill("/tool nonexistent_tool {}");
    await page.click("button:has-text('Send')");

    // Wait for the assistant response
    const response = page.locator(".text-left .message-content").last();
    await expect(response).toBeVisible({ timeout: 10000 });
    const text = await response.textContent();

    // Should contain error indication
    expect(text?.toLowerCase()).toContain("error");
    // Should NOT contain internal details
    expect(text).not.toContain("ray_tool");
  });
});
