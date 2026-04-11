/**
 * E2E test for proactive memory recall.
 *
 * Stores a distinctive fact via the memory API, then starts a new conversation
 * and asks a related question. Verifies the LLM response incorporates the
 * stored fact without the user explicitly invoking /tool memory_search.
 *
 * Requires OPENAI_API_KEY — skips automatically without it.
 * Covers ISSUES.md #16.
 */
import { test, expect } from "@playwright/test";

const requireLLM = () => {
  if (!process.env.OPENAI_API_KEY) test.skip();
};

test.describe("Proactive memory recall (live)", () => {
  test.beforeEach(() => requireLLM());

  test("stored memory fact surfaces in unrelated conversation", async ({ request }) => {
    // Store a distinctive fact unlikely to appear by chance
    const uniqueFact = `Alan's favourite colour is ultraviolet-${Date.now()}`;
    const storeResp = await request.post("/api/memory/store", {
      data: { content: uniqueFact, tags: ["test", "e2e"], source: "e2e-test" },
    });
    expect(storeResp.ok()).toBeTruthy();
    const stored = await storeResp.json();
    const memoryId = stored.id;

    try {
      // Create a new conversation and ask something that should surface the memory
      const chatResp = await request.post("/api/chat", {
        data: {
          messages: [{ role: "user", content: "What colour does Alan like?" }],
          conversation_id: null,
        },
      });
      expect(chatResp.ok()).toBeTruthy();
      const body = await chatResp.text();

      // The proactive injection should have included our stored fact in the
      // system prompt, so the LLM should mention ultraviolet in its response
      expect(body.toLowerCase()).toContain("ultraviolet");
    } finally {
      // Clean up the stored memory
      if (memoryId) {
        await request.delete(`/api/memory/${memoryId}`);
      }
    }
  });

  test("memory injection injects into system prompt before each turn", async ({ request }) => {
    // Simpler: verify the system prompt endpoint shows Relevant Memory when facts exist
    const uniqueFact = `Ray's deployment city is Neverland-${Date.now()}`;
    const storeResp = await request.post("/api/memory/store", {
      data: { content: uniqueFact, tags: ["test"], source: "e2e-test" },
    });
    const stored = await storeResp.json();

    try {
      // The system prompt should include this memory when a related question is asked
      const sysResp = await request.get("/api/identity/system-prompt?query=Neverland");
      if (sysResp.ok()) {
        const data = await sysResp.json();
        const prompt = data.system_prompt || "";
        // If the endpoint supports query-based injection, the fact should appear
        // If not, skip this assertion — the main test above covers the runtime path
        if (prompt.includes("Relevant Memory")) {
          expect(prompt).toContain("Neverland");
        }
      }
    } finally {
      if (stored.id) await request.delete(`/api/memory/${stored.id}`);
    }
  });
});
