import { test, expect } from "@playwright/test";

/**
 * E2E tests for bootstrap completion output, bootstrap enforcement,
 * and workspace context preservation across sessions.
 *
 * These tests verify:
 * 1. /bootstrap done emits clean output (not raw markdown)
 * 2. Bootstrap mode enforces onboarding compliance
 * 3. New sessions retain workspace file context (SOUL.md, USER.md, etc.)
 * 4. System prompt includes identity files in the correct order
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SSEEvent {
  type?: string;
  content?: string;
  action?: string;
  choices?: { delta: { content?: string }; index: number }[];
  [key: string]: unknown;
}

function parseSSE(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const data = trimmed.slice(6);
    if (data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // skip non-JSON
    }
  }
  return events;
}

/** Concatenate all streamed content from SSE events into a single string. */
function extractContent(events: SSEEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type === "command_result" && e.content) {
      text += e.content;
    }
    const delta = e.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
    }
  }
  return text;
}

/** Fetch with retry on 429 rate limit. */
async function fetchWithRetry(
  request: any,
  method: "get" | "post" | "put" | "delete",
  url: string,
  options?: Record<string, unknown>,
  retries = 3,
): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const resp = options
      ? await request[method](url, options)
      : await request[method](url);
    if (resp.status() !== 429) return resp;
    // Wait before retrying (exponential backoff)
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return options
    ? await request[method](url, options)
    : await request[method](url);
}

/** Send a chat message via the API and return parsed SSE events. */
async function chatSSE(
  request: any,
  messages: { role: string; content: string }[],
  conversationId?: string,
): Promise<SSEEvent[]> {
  const payload: Record<string, unknown> = { messages };
  if (conversationId) payload.conversation_id = conversationId;
  const resp = await fetchWithRetry(request, "post", "/api/chat", {
    data: payload,
  });
  return parseSSE(await resp.text());
}

// ---------------------------------------------------------------------------
// Bootstrap done: clean output
// ---------------------------------------------------------------------------

test.describe("Bootstrap done output", () => {
  test("/bootstrap done with markers returns clean message, not raw markdown", async ({
    request,
  }) => {
    // Read current identity files so we can use them in markers.
    // This way mark_bootstrapped overwrites with the SAME content (non-destructive).
    const origSoul = (await (await request.get("/api/identity/soul")).json())
      .content as string;
    const origUser = (await (await request.get("/api/identity/me")).json())
      .content as string;
    const origIdentity = (
      await (await request.get("/api/identity/identity")).json()
    ).content as string;

    // Extract a name from the existing USER.md for greeting assertion
    const nameMatch = origUser.match(/\*\*Name:\*\*\s*(.+)/);
    const expectedName = nameMatch ? nameMatch[1].trim().replace(/[^\w\s]/g, "").trim() : "";

    let convId: string | null = null;

    try {
      // Create a conversation with bootstrap markers using EXISTING identity
      // content so mark_bootstrapped is a no-op (writes the same data back).
      const conv = await (
        await request.post("/api/conversations", {
          data: { title: "Bootstrap Output Test" },
        })
      ).json();
      convId = conv.id;

      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: { role: "user", content: "Finishing setup" },
      });
      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: {
          role: "assistant",
          content: [
            "---IDENTITY_START---",
            origIdentity || "# IDENTITY\nRay",
            "---IDENTITY_END---",
            "",
            "---SOUL_START---",
            origSoul || "# SOUL\nBe helpful.",
            "---SOUL_END---",
            "",
            "---USER_START---",
            origUser || "# USER\n**Name:** User",
            "---USER_END---",
          ].join("\n"),
        },
      });

      // Send /bootstrap done via chat
      const events = await chatSSE(
        request,
        [
          { role: "user", content: "Finishing setup" },
          { role: "assistant", content: "Ready to save." },
          { role: "user", content: "/bootstrap done" },
        ],
        conv.id,
      );

      const content = extractContent(events);

      // Clean output: "Updated IDENTITY.md, SOUL.md, USER.md."
      expect(content).toContain("Updated");
      expect(content).toContain("IDENTITY.md");
      expect(content).toContain("SOUL.md");
      expect(content).toContain("USER.md");

      // Personalised greeting with extracted name
      if (expectedName) {
        expect(content).toContain(`Hi ${expectedName}, how can I help?`);
      } else {
        expect(content).toContain("how can I help?");
      }

      // Must NOT contain raw markdown file content or markers
      expect(content).not.toContain("---IDENTITY_START---");
      expect(content).not.toContain("---SOUL_START---");
      expect(content).not.toContain("---USER_START---");
    } finally {
      if (convId) {
        await request.delete(`/api/conversations/${convId}`);
      }
    }
  });

  test("/bootstrap done without markers returns redirect with finalize flag", async ({
    request,
  }) => {
    // Create a conversation with NO bootstrap markers
    const conv = await (
      await request.post("/api/conversations", {
        data: { title: "Bootstrap No Markers Test" },
      })
    ).json();

    try {
      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: { role: "user", content: "I like cats" },
      });
      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: {
          role: "assistant",
          content: "Cats are great!",
        },
      });

      // Send /bootstrap done. With no markers, the command handler returns
      // a redirect with bootstrap_finalize: true. The chat endpoint will
      // buffer the LLM response and return a clean command_result.
      // We just verify the SSE response is NOT raw streamed markdown.
      const events = await chatSSE(
        request,
        [
          { role: "user", content: "I like cats" },
          { role: "assistant", content: "Cats are great!" },
          { role: "user", content: "/bootstrap done" },
        ],
        conv.id,
      );

      const content = extractContent(events);

      // Should NOT contain bootstrap markers in the output
      expect(content).not.toContain("---IDENTITY_START---");
      expect(content).not.toContain("---SOUL_START---");
      expect(content).not.toContain("---USER_START---");

      // Should be a clean message: success, save failure, or LLM error
      const isClean =
        content.includes("Updated") ||
        content.includes("Could not save") ||
        content.includes("Bootstrap failed");
      expect(isClean).toBeTruthy();
    } finally {
      await request.delete(`/api/conversations/${conv.id}`);
    }
  });

  test("/bootstrap done without conversation returns usage", async ({
    request,
  }) => {
    const events = await chatSSE(request, [
      { role: "user", content: "/bootstrap done" },
    ]);

    const content = extractContent(events);
    // Without a conversation_id, markers cannot be found.
    // The handler should still return something useful (redirect or usage).
    expect(content).toBeTruthy();
  });

  test("/bootstrap status returns state", async ({ request }) => {
    const events = await chatSSE(request, [
      { role: "user", content: "/bootstrap status" },
    ]);

    const content = extractContent(events);
    expect(content.toLowerCase()).toContain("bootstrap");
    // Should contain either "complete" or "pending"
    const hasState =
      content.toLowerCase().includes("complete") ||
      content.toLowerCase().includes("pending");
    expect(hasState).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Workspace context preservation across sessions
// ---------------------------------------------------------------------------

test.describe("Session context preservation", () => {
  test.beforeEach(async ({ request }) => {
    // These tests require bootstrap to be complete
    const status = await (
      await fetchWithRetry(request, "get", "/api/identity/bootstrap-status")
    ).json();
    test.skip(!status.bootstrapped, "Requires completed bootstrap");
  });

  test("identity files are loaded and accessible via API", async ({ request }) => {
    const soul = await (await request.get("/api/identity/soul")).json();
    const user = await (await request.get("/api/identity/me")).json();
    const identity = await (
      await request.get("/api/identity/identity")
    ).json();

    // All three identity files should have substantive content
    expect(soul.content).toBeTruthy();
    expect(soul.content.length).toBeGreaterThan(10);
    expect(user.content).toBeTruthy();
    expect(user.content.length).toBeGreaterThan(10);
    expect(identity.content).toBeTruthy();
    expect(identity.content.length).toBeGreaterThan(5);

    // USER.md should contain a Name field
    expect(user.content).toMatch(/name/i);
  });

  test("LLM knows user name from workspace context in a fresh session", async ({
    request,
  }) => {
    // Extract the user's name from USER.md to know what to expect.
    // Handles both "**Name:** Alan" and "## Display name\nAlan" formats.
    const user = await (await request.get("/api/identity/me")).json();
    const userContent = (user.content || "") as string;
    let expectedName = "";
    const boldMatch = userContent.match(/\*\*Name:\*\*\s*(.+)/);
    const displayMatch = userContent.match(/##\s*Display name\s*\n+\s*(\S+)/i);
    if (boldMatch) {
      expectedName = boldMatch[1].trim().split(/\s/)[0].replace(/[^\w]/g, "").toLowerCase();
    } else if (displayMatch) {
      expectedName = displayMatch[1].trim().replace(/[^\w]/g, "").toLowerCase();
    }
    test.skip(!expectedName, "Cannot extract user name from USER.md");

    // Start a fresh conversation and ask for the user's name.
    // This verifies workspace files (USER.md) are in the system prompt.
    const events = await chatSSE(request, [
      {
        role: "user",
        content:
          "What is my name? Reply with ONLY my first name and nothing else.",
      },
    ]);

    const content = extractContent(events).trim().toLowerCase();
    // LLM call may fail if no provider is configured
    if (!content) {
      test.skip();
      return;
    }
    expect(content).toContain(expectedName);
  });

  test("LLM personality matches SOUL.md after new session", async ({
    request,
  }) => {
    const events = await chatSSE(request, [
      {
        role: "user",
        content:
          "In one sentence, how would you describe your communication style based on your instructions?",
      },
    ]);

    const content = extractContent(events).toLowerCase();
    if (!content) {
      test.skip();
      return;
    }

    // Should reflect some aspect of the SOUL.md personality
    const matchesPersonality =
      content.includes("direct") ||
      content.includes("terse") ||
      content.includes("concise") ||
      content.includes("brief") ||
      content.includes("short") ||
      content.includes("helpful");
    expect(matchesPersonality).toBeTruthy();
  });

  test("system prompt includes workspace file sections", async ({
    request,
  }) => {
    const events = await chatSSE(request, [
      {
        role: "user",
        content:
          'List the workspace files mentioned in your system context. Reply with just the filenames, one per line (e.g. "SOUL.md").',
      },
    ]);

    const content = extractContent(events);
    if (!content) {
      test.skip();
      return;
    }
    // Should mention at least SOUL.md and USER.md
    expect(content).toContain("SOUL");
    expect(content).toContain("USER");
  });
});

// ---------------------------------------------------------------------------
// Bootstrap enforcement (non-destructive)
// ---------------------------------------------------------------------------

test.describe("Bootstrap enforcement", () => {
  test("bootstrap status reports correct state", async ({ request }) => {
    const status = await (
      await fetchWithRetry(request, "get", "/api/identity/bootstrap-status")
    ).json();
    expect(status).toHaveProperty("bootstrapped");
    expect(typeof status.bootstrapped).toBe("boolean");

    // If bootstrapped, /bootstrap status command should confirm it
    if (status.bootstrapped) {
      const events = await chatSSE(request, [
        { role: "user", content: "/bootstrap status" },
      ]);
      const content = extractContent(events);
      expect(content.toLowerCase()).toContain("complete");
    }
  });

  test("bootstrap enforcement: off-topic is redirected during onboarding", async ({
    request,
  }) => {
    // This test only runs when NOT bootstrapped.
    // During bootstrap mode, the agent should steer back to onboarding.
    const status = await (
      await fetchWithRetry(request, "get", "/api/identity/bootstrap-status")
    ).json();
    test.skip(status.bootstrapped, "Only testable when not bootstrapped");

    const events = await chatSSE(request, [
      { role: "user", content: "What is 2 + 2?" },
    ]);
    const content = extractContent(events).toLowerCase();
    if (!content) {
      test.skip();
      return;
    }

    // Should steer toward onboarding, not just answer "4"
    const isOnboarding =
      content.includes("name") ||
      content.includes("set up") ||
      content.includes("bootstrap") ||
      content.includes("onboarding") ||
      content.includes("tell me") ||
      content.includes("who");
    expect(isOnboarding).toBeTruthy();
  });

  test("/bootstrap status command round-trip", async ({ request }) => {
    const status = await (
      await fetchWithRetry(request, "get", "/api/identity/bootstrap-status")
    ).json();
    test.skip(!status.bootstrapped, "Requires completed bootstrap");

    const events = await chatSSE(request, [
      { role: "user", content: "/bootstrap status" },
    ]);
    const content = extractContent(events);
    expect(content.toLowerCase()).toContain("complete");
  });
});

// ---------------------------------------------------------------------------
// Bootstrap done via UI (requires full stack: UI + API)
// These tests are skipped when only the API server is running.
// Run with the full playwright.config.ts to execute these.
// ---------------------------------------------------------------------------

test.describe("Bootstrap done via UI", () => {
  test.beforeEach(async ({ page }) => {
    try {
      const resp = await page.goto("/", { timeout: 5000 });
      if (!resp || !resp.ok()) test.skip();
    } catch {
      test.skip();
    }
  });

  test("/bootstrap done shows clean message in chat bubble", async ({
    page,
    request,
  }) => {
    // Use existing identity data for markers (non-destructive)
    const origSoul = (await (await request.get("/api/identity/soul")).json())
      .content as string;
    const origUser = (await (await request.get("/api/identity/me")).json())
      .content as string;
    const origIdentity = (
      await (await request.get("/api/identity/identity")).json()
    ).content as string;

    let convId: string | null = null;

    try {
      const conv = await (
        await request.post("/api/conversations", {
          data: { title: "UI Bootstrap Test" },
        })
      ).json();
      convId = conv.id;

      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: { role: "user", content: "Finishing setup" },
      });
      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: {
          role: "assistant",
          content: [
            "---IDENTITY_START---",
            origIdentity || "# IDENTITY\nRay",
            "---IDENTITY_END---",
            "",
            "---SOUL_START---",
            origSoul || "# SOUL\nBe helpful.",
            "---SOUL_END---",
            "",
            "---USER_START---",
            origUser || "# USER\n**Name:** User",
            "---USER_END---",
          ].join("\n"),
        },
      });

      // Load the conversation in the UI
      await page.goto("/");
      await page.click(`text=UI Bootstrap Test`);
      await expect(page.locator("text=Finishing setup")).toBeVisible({
        timeout: 5000,
      });

      // Type /bootstrap done
      await page.locator("textarea").fill("/bootstrap done");
      await page.click("button:has-text('Send')");

      // Wait for the response
      const response = page.locator(".message-content").last();
      await expect(response).toBeVisible({ timeout: 10000 });
      const text = await response.textContent();

      // Should show clean output
      expect(text).toContain("Updated");
      expect(text).toContain("how can I help");

      // Should NOT show raw markdown
      expect(text).not.toContain("---IDENTITY_START---");
      expect(text).not.toContain("# SOUL");
    } finally {
      if (convId) {
        await request.delete(`/api/conversations/${convId}`);
      }
    }
  });
});
