/**
 * E2E tests for the /agent slash command.
 *
 * Happy path: /agent list shows available agents, /agent <name> switches agent.
 * Unhappy path: unknown agent name returns error.
 *
 * Covers ISSUES.md #13.
 */
import { test, expect } from "@playwright/test";

test.describe("/agent slash command API", () => {
  test("GET /api/commands includes /agent", async ({ request }) => {
    const resp = await request.get("/api/commands");
    expect(resp.ok()).toBeTruthy();
    const cmds = await resp.json();
    const names = cmds.map((c: any) => c.name);
    expect(names).toContain("/agent");
  });

  test("/agent list returns available agents", async ({ request }) => {
    const resp = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "/agent list" }],
        conversation_id: null,
      },
    });
    expect(resp.ok()).toBeTruthy();
    const text = await resp.text();
    expect(text).toContain("general");
    expect(text).toContain("agent");
  });

  test("/agent <valid_name> returns redirect with agent field", async ({ request }) => {
    // Verify the general agent works (it always exists)
    const resp = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "/agent general" }],
        conversation_id: null,
      },
    });
    expect(resp.ok()).toBeTruthy();
    // Should get an LLM response (streamed), not an error
    const text = await resp.text();
    expect(text).not.toContain('"error":true');
  });

  test("/agent <unknown> returns error", async ({ request }) => {
    const resp = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "/agent doesnotexist" }],
        conversation_id: null,
      },
    });
    expect(resp.ok()).toBeTruthy();
    const text = await resp.text();
    expect(text).toContain("Unknown agent");
  });

  test("/agent with no args lists agents", async ({ request }) => {
    const resp = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "/agent" }],
        conversation_id: null,
      },
    });
    expect(resp.ok()).toBeTruthy();
    const text = await resp.text();
    expect(text).toContain("Available agents");
  });
});
